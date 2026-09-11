// Process lifecycle and termination guard
// Ensures child processes (like FFmpeg) never outlive Vega or their active playback sessions.

#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};

#[cfg(target_os = "windows")]
static JOB_OBJECT_INITIALIZED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "windows")]
static JOB_HANDLE: AtomicIsize = AtomicIsize::new(0);

/// Initializes an OS-level Job Object on Windows configured with
/// JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE.
///
/// Any child process spawned by Vega (or any of its threads/sidecars) will
/// automatically belong to this Job Object. When Vega terminates or exits for
/// any reason, the Windows kernel forcefully and immediately terminates all
/// processes associated with the Job Object, preventing orphaned background processes.
pub fn init_process_guard() {
    #[cfg(target_os = "windows")]
    {
        if JOB_OBJECT_INITIALIZED.swap(true, Ordering::SeqCst) {
            return;
        }

        unsafe {
            use windows::Win32::System::JobObjects::{
                AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
                JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
                JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
            };
            use windows::Win32::System::Threading::GetCurrentProcess;

            match CreateJobObjectW(None, None) {
                Ok(job_handle) => {
                    let mut info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
                    info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

                    let set_res = SetInformationJobObject(
                        job_handle,
                        JobObjectExtendedLimitInformation,
                        &info as *const _ as *const std::ffi::c_void,
                        std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                    );

                    if set_res.is_ok() {
                        let current_process = GetCurrentProcess();
                        let assign_res = AssignProcessToJobObject(job_handle, current_process);
                        if assign_res.is_ok() {
                            // Retain the job handle open for the entire process lifetime
                            JOB_HANDLE.store(job_handle.0 as isize, Ordering::SeqCst);
                            eprintln!("[process_guard] Windows Job Object initialized with KILL_ON_JOB_CLOSE");
                            return;
                        } else {
                            eprintln!("[process_guard] Failed to assign process to Job Object: {:?}", assign_res);
                        }
                    } else {
                        eprintln!("[process_guard] Failed to set Job Object info: {:?}", set_res);
                    }
                    let _ = windows::Win32::Foundation::CloseHandle(job_handle);
                }
                Err(e) => {
                    eprintln!("[process_guard] Failed to create Job Object: {:?}", e);
                }
            }
        }
    }
}

/// Immediately terminates a process by its OS PID.
/// On Windows, uses TerminateProcess with PROCESS_TERMINATE rights.
/// On Unix/macOS, invokes kill -9 <pid>.
pub fn kill_pid(pid: u32) {
    if pid == 0 {
        return;
    }

    #[cfg(target_os = "windows")]
    unsafe {
        use windows::Win32::Foundation::CloseHandle;
        use windows::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};

        if let Ok(handle) = OpenProcess(PROCESS_TERMINATE, false, pid) {
            let _ = TerminateProcess(handle, 1);
            let _ = CloseHandle(handle);
            eprintln!("[process_guard] Forcefully killed process PID {}", pid);
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = std::process::Command::new("kill")
            .arg("-9")
            .arg(pid.to_string())
            .output();
        eprintln!("[process_guard] Forcefully killed process PID {}", pid);
    }
}
