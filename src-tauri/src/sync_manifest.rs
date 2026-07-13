use std::path::{Component, Path, PathBuf};

const SYNC_DIRECTORY: &str = ".vega-sync";

fn safe_relative_path(relative_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative_path);
    if path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::RootDir | Component::Prefix(_)))
    {
        return Err("Invalid relative media path".into());
    }
    Ok(path.to_path_buf())
}

fn resolve_existing_media_path(base_dir: &Path, relative: &Path) -> Option<PathBuf> {
    let path = base_dir.join(relative);
    if path.is_file() {
        return Some(path);
    }
    let parent = path.parent()?;
    let expected_stem = path.file_stem()?;
    std::fs::read_dir(parent)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .find(|candidate| candidate.is_file() && candidate.file_stem() == Some(expected_stem))
}

#[tauri::command]
pub async fn read_sync_manifests(base_dir: String) -> Result<Vec<String>, String> {
    let sync_dir = Path::new(&base_dir).join(SYNC_DIRECTORY);
    if !sync_dir.exists() {
        return Ok(Vec::new());
    }
    let mut entries = tokio::fs::read_dir(sync_dir)
        .await
        .map_err(|error| error.to_string())?;
    let mut manifests = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|error| error.to_string())?
    {
        let path = entry.path();
        if path.extension().and_then(|extension| extension.to_str()) != Some("json") {
            continue;
        }
        if let Ok(content) = tokio::fs::read_to_string(path).await {
            manifests.push(content);
        }
    }
    Ok(manifests)
}

#[tauri::command]
pub async fn write_sync_manifest(
    base_dir: String,
    device_id: String,
    content: String,
) -> Result<(), String> {
    if !device_id
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || character == '-')
    {
        return Err("Invalid sync device id".into());
    }
    let sync_dir = Path::new(&base_dir).join(SYNC_DIRECTORY);
    tokio::fs::create_dir_all(&sync_dir)
        .await
        .map_err(|error| error.to_string())?;
    let target = sync_dir.join(format!("vega-{device_id}.json"));
    let temporary = sync_dir.join(format!("vega-{device_id}.tmp"));
    tokio::fs::write(&temporary, content)
        .await
        .map_err(|error| error.to_string())?;
    if target.exists() {
        tokio::fs::remove_file(&target)
            .await
            .map_err(|error| error.to_string())?;
    }
    tokio::fs::rename(temporary, target)
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn resolve_sync_media_path(
    base_dir: String,
    relative_path: String,
) -> Result<Option<String>, String> {
    let relative = safe_relative_path(&relative_path)?;
    Ok(resolve_existing_media_path(Path::new(&base_dir), &relative)
        .map(|path| path.to_string_lossy().into_owned()))
}

#[cfg(test)]
mod tests {
    use super::resolve_existing_media_path;
    use std::path::Path;

    #[test]
    fn resolves_same_stem_when_manifest_extension_is_stale() {
        let root = std::env::temp_dir().join(format!(
            "vega-sync-resolver-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let season = root.join("show").join("season_1");
        std::fs::create_dir_all(&season).unwrap();
        let actual = season.join("Episode_1.mp4");
        std::fs::write(&actual, b"video").unwrap();

        let resolved = resolve_existing_media_path(
            &root,
            Path::new("show/season_1/Episode_1.mkv"),
        );

        assert_eq!(resolved.as_deref(), Some(actual.as_path()));
        std::fs::remove_dir_all(root).unwrap();
    }
}