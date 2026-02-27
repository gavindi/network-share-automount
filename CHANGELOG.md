# Changelog

All notable changes to Network Share Automount are documented here.

---

### Version 5.0 - 2026-02-27
#### 🔧 GNOME Extension Compliance Fixes
- **Signal cleanup**: Settings signal handler IDs are now stored and explicitly disconnected in `disable()`, satisfying GNOME review requirements
- **File monitor cleanup**: Bookmarks file monitor signal handler is explicitly disconnected before `cancel()` on disable
- **Deprecated API**: Replaced `Gtk.FileChooserDialog` (deprecated GTK 4.10+) with the modern async `Gtk.FileDialog` API
- **Deprecated API**: Replaced `GLib.spawn_command_line_async()` with `Gio.DesktopAppInfo` for launching GNOME Logs
- **Logging**: Removed excessive `console.log` debug output; only `console.error` and `console.warn` remain
- **i18n**: Replaced template literals inside `_()` calls with proper `_('…%d…').format()` strings so translatable strings are extractable by xgettext
- **Metadata**: Removed speculative future GNOME version `"50"` from `shell-version`; maximum one development version is permitted by EGO policy
- **Version display**: Corrected About page version to match `metadata.json`

---

### Version 3.0 - 2025-01-XX
#### 🚀 Performance Improvements
- **Major**: Implemented file monitoring for bookmarks instead of periodic disk reads
  - Extension now uses `Gio.File.monitor_file()` to watch `~/.config/gtk-3.0/bookmarks`
  - Bookmarks are only reloaded when the file actually changes
  - Dramatically reduced disk I/O and CPU usage during periodic checks
- **Optimization**: Periodic timer now only checks mount status, not file system
- **Enhancement**: Added debounced file change detection (500ms) to handle rapid file modifications
- **Feature**: Added "Reload Bookmarks" menu option for manual refresh
- **Improvement**: Runtime state (fail counts, settings) preserved during bookmark reloads
- **Battery**: Reduced battery usage on laptops due to less frequent file system access

#### 🎨 Visual Enhancements
- **New**: Custom SVG icons for connection status
  - Connected state: Green indicator for successful mounts
  - Mounting/Disconnected state: Red indicator during operations
  - Automatic theme adaptation using currentColor
- **Enhancement**: Real-time visual feedback during mount operations
- **Integration**: Custom icons used consistently in panel and preferences About page
- **Improvement**: Clear status indicators in panel menu
- **Fallback**: Graceful fallback to system icons if custom SVGs are missing

#### 🔧 Build System Improvements
- **Enhanced Makefile**: Comprehensive build automation with icon support
- **New Commands**: Added validate, watch, logs, and help targets
- **Icon Management**: Automatic copying of icons directory during build
- **Validation**: File structure and dependency checking
- **Development**: Streamlined development workflow with auto-rebuild

#### 🐛 Bug Fixes
- **Resource Management**: Proper cleanup of file monitor in destroy() method
- **Memory**: Better timeout tracking and cleanup
- **Icons**: Graceful fallback to system icons if custom SVGs missing

#### 🔧 Technical Changes
- Separated bookmark loading logic from periodic mount checking
- Enhanced error handling for file monitoring fallback
- Improved logging for debugging bookmark file changes
- Added mounting state tracking for accurate icon updates

---

### Version 2.0 - 2025-01-XX
#### ✨ Features
- Advanced symlink configuration with custom paths
- Per-bookmark auto-mount and symlink settings
- Retry mechanism for failed mounts with configurable attempts and delays
- Comprehensive notification system with granular controls
- Custom base directory for symlinks with file browser
- Enhanced preferences UI with tabbed organization

#### 🎨 UI/UX Improvements
- Collapsible bookmark submenus in panel indicator
- Real-time status indicators (🟢 mounted, ⚪ unmounted, 🟡 failed)
- Detailed mount status and connection information
- Individual mount/unmount controls per bookmark

---

### Version 1.0 - 2025-01-XX
#### 🎉 Initial Release
- Basic automatic mounting of bookmarked network shares
- Periodic mount checking with configurable intervals
- Simple notification system
- GNOME Shell 45+ compatibility
- Basic symlink creation for mounted shares
