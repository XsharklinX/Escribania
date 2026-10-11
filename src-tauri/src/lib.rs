mod analysis;
mod assets;
mod backup;
mod epub;
mod fsx;
mod import;
mod paths;
mod project;
mod search;
mod settings;
mod snapshots;
mod typeset;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            paths::app_info,
            settings::settings_load,
            settings::settings_save,
            project::project_create,
            project::project_open,
            project::project_save,
            project::text_read,
            project::text_write,
            project::text_delete,
            project::file_write_text,
            project::file_write_bytes,
            backup::project_backup,
            search::project_search,
            search::project_replace,
            search::codex_mentions,
            snapshots::snapshot_create,
            snapshots::snapshot_list,
            snapshots::snapshot_read,
            snapshots::snapshot_delete,
            assets::asset_import,
            assets::asset_read,
            assets::asset_read_text,
            assets::asset_write_text,
            assets::asset_delete,
            assets::web_fetch,
            assets::project_json_read,
            assets::project_json_write,
            assets::app_json_read,
            assets::app_json_write,
            typeset::typeset,
            typeset::typeset_last,
            typeset::typeset_fonts,
            epub::epub_build,
            import::import_project,
            import::docx_review,
            analysis::texts_stats,
        ])
        .run(tauri::generate_context!())
        .expect("error al arrancar Escribanía");
}
