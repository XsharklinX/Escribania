// En release no se abre una consola junto a la ventana en Windows.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    escribania_lib::run()
}
