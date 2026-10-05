//! SOCKS5 front for ByeDPI. ciadpi resolves domain names with the system DNS, and on ISPs that
//! block sites that DNS returns the block page address, so ByeDPI would connect to the wrong
//! server. This relay resolves names with DNS over HTTPS and hands ByeDPI only the IP address,
//! as the Android app does.

use std::io::{Error, ErrorKind};
use std::net::IpAddr;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;

const SOCKS_VERSION: u8 = 5;
const REPLY_GENERAL_FAILURE: u8 = 1;
const REPLY_HOST_UNREACHABLE: u8 = 4;
const REPLY_COMMAND_NOT_SUPPORTED: u8 = 7;
const REPLY_ADDRESS_NOT_SUPPORTED: u8 = 8;
/// Addresses of one host tried before the connection fails.
const MAX_ADDRESS_ATTEMPTS: usize = 3;

/// Starts the relay in front of ByeDPI listening on `upstream_port`. Returns the relay port and
/// its task; aborting the task stops new connections.
pub async fn start(upstream_port: u16) -> Result<(u16, JoinHandle<()>), String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to start ByeDPI relay: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to read ByeDPI relay address: {}", e))?
        .port();

    let task = tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((client, _)) => {
                    tokio::spawn(async move {
                        if let Err(e) = relay(client, upstream_port).await {
                            vlog_debug!("[byedpi_relay] Connection ended: {}", e);
                        }
                    });
                }
                Err(e) => {
                    vlog_warn!("[byedpi_relay] Accept failed: {}", e);
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                }
            }
        }
    });
    Ok((port, task))
}

fn protocol_error(message: &str) -> Error {
    Error::new(ErrorKind::InvalidData, message.to_string())
}

async fn send_reply(client: &mut TcpStream, code: u8) -> std::io::Result<()> {
    client
        .write_all(&[SOCKS_VERSION, code, 0, 1, 0, 0, 0, 0, 0, 0])
        .await
}

async fn relay(mut client: TcpStream, upstream_port: u16) -> std::io::Result<()> {
    // Greeting: version, method count, methods. Only "no authentication" is offered.
    let mut greeting = [0u8; 2];
    client.read_exact(&mut greeting).await?;
    if greeting[0] != SOCKS_VERSION {
        return Err(protocol_error("not a SOCKS5 client"));
    }
    let mut methods = vec![0u8; greeting[1] as usize];
    client.read_exact(&mut methods).await?;
    if !methods.contains(&0) {
        client.write_all(&[SOCKS_VERSION, 0xFF]).await?;
        return Err(protocol_error("client needs authentication"));
    }
    client.write_all(&[SOCKS_VERSION, 0]).await?;

    // Request: version, command, reserved, address type, address, port.
    let mut request = [0u8; 4];
    client.read_exact(&mut request).await?;
    if request[1] != 1 {
        send_reply(&mut client, REPLY_COMMAND_NOT_SUPPORTED).await?;
        return Err(protocol_error("only CONNECT is supported"));
    }
    // Ok holds an IP address, Err a host name still to resolve.
    let target: Result<IpAddr, String> = match request[3] {
        1 => {
            let mut octets = [0u8; 4];
            client.read_exact(&mut octets).await?;
            Ok(IpAddr::from(octets))
        }
        4 => {
            let mut octets = [0u8; 16];
            client.read_exact(&mut octets).await?;
            Ok(IpAddr::from(octets))
        }
        3 => {
            let mut len = [0u8; 1];
            client.read_exact(&mut len).await?;
            let mut name = vec![0u8; len[0] as usize];
            client.read_exact(&mut name).await?;
            Err(String::from_utf8_lossy(&name).into_owned())
        }
        _ => {
            send_reply(&mut client, REPLY_ADDRESS_NOT_SUPPORTED).await?;
            return Err(protocol_error("unknown address type"));
        }
    };
    let mut port_bytes = [0u8; 2];
    client.read_exact(&mut port_bytes).await?;

    let ips = match target {
        Ok(ip) => vec![ip],
        Err(host) => {
            let ips = crate::stream_server::GLOBAL_STREAM_RESOLVER
                .resolve_for_bypass(&host)
                .await;
            if ips.is_empty() {
                send_reply(&mut client, REPLY_HOST_UNREACHABLE).await?;
                return Err(Error::new(
                    ErrorKind::NotFound,
                    format!("cannot resolve {}", host),
                ));
            }
            ips
        }
    };

    // A host often has several addresses and one of them may be unreachable, so try a few
    // before giving up. The client gets ByeDPI's last reply.
    let mut last_reply = None;
    for ip in ips.into_iter().take(MAX_ADDRESS_ATTEMPTS) {
        match connect_through_byedpi(upstream_port, ip, port_bytes).await {
            Ok((mut upstream, reply)) => {
                if reply[1] == 0 {
                    client.write_all(&reply).await?;
                    tokio::io::copy_bidirectional(&mut client, &mut upstream).await?;
                    return Ok(());
                }
                vlog_debug!("[byedpi_relay] ByeDPI could not reach {} (reply {})", ip, reply[1]);
                last_reply = Some(reply);
            }
            Err(e) => vlog_debug!("[byedpi_relay] ByeDPI connection for {} failed: {}", ip, e),
        }
    }
    match last_reply {
        Some(reply) => client.write_all(&reply).await,
        None => send_reply(&mut client, REPLY_GENERAL_FAILURE).await,
    }
}

/// Opens a SOCKS5 connection to `ip` through ByeDPI. Returns the stream and ByeDPI's reply.
async fn connect_through_byedpi(
    upstream_port: u16,
    ip: IpAddr,
    port_bytes: [u8; 2],
) -> std::io::Result<(TcpStream, Vec<u8>)> {
    let mut upstream = TcpStream::connect(("127.0.0.1", upstream_port)).await?;
    upstream.write_all(&[SOCKS_VERSION, 1, 0]).await?;
    let mut method = [0u8; 2];
    upstream.read_exact(&mut method).await?;
    if method != [SOCKS_VERSION, 0] {
        return Err(protocol_error("ByeDPI refused the SOCKS greeting"));
    }

    let mut connect = vec![SOCKS_VERSION, 1, 0];
    match ip {
        IpAddr::V4(v4) => {
            connect.push(1);
            connect.extend_from_slice(&v4.octets());
        }
        IpAddr::V6(v6) => {
            connect.push(4);
            connect.extend_from_slice(&v6.octets());
        }
    }
    connect.extend_from_slice(&port_bytes);
    upstream.write_all(&connect).await?;

    let mut reply = vec![0u8; 4];
    upstream.read_exact(&mut reply).await?;
    let address_len = match reply[3] {
        1 => 4,
        4 => 16,
        3 => {
            let mut len = [0u8; 1];
            upstream.read_exact(&mut len).await?;
            reply.push(len[0]);
            len[0] as usize
        }
        _ => return Err(protocol_error("ByeDPI sent an unknown address type")),
    };
    let mut rest = vec![0u8; address_len + 2];
    upstream.read_exact(&mut rest).await?;
    reply.extend_from_slice(&rest);
    Ok((upstream, reply))
}
