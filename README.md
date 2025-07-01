# Network Share Automount
![screenshot](https://github.com/gavindi/network-automount/blob/master/media/NetworkautomountScreenshot.png)

## Mount your bookmarked network shares
This extension will mount your bookmarked network shares and periodically check them should they become unmounted for any reason.  It has options to control (re)mount frequency and provides visual status feedback through custom icons.

I was inspired by [Gigolo](https://docs.xfce.org/apps/gigolo/start) but sometimes crashes and also doesn't display a MessageTray icon under Wayland sessions.  Also, I thought "why does this need to be an app?".  So, I vibed with Claude to create this.

## Features

- ✅ **Automatic mounting** of bookmarked network shares
- ✅ **Custom symlink creation** for easy access from your home directory
- ✅ **Visual status indicators** with custom SVG icons and consistent UI branding
- ✅ **Retry mechanism** for failed mounts with configurable attempts
- ✅ **Per-bookmark configuration** for auto-mount and symlink settings
- ✅ **Comprehensive notification system** with granular controls
- ✅ **Real-time file monitoring** for bookmark changes
- ✅ **Advanced preferences UI** with tabbed organization and custom icons

## Installation from source

The extension can be installed directly from source, either for the convenience of using git or to test the latest development version. Clone the desired branch with git

### Build Dependencies

This extension has no special build dependencies.

### Required Files Structure

```
network-automount/
├── extension.js                    # Main extension code
├── prefs.js                       # Preferences UI
├── metadata.json                  # Extension metadata
├── Makefile                       # Build automation
├── schemas/
│   └── org.gnome.shell.extensions.network-share-automount.gschema.xml
├── icons/                         # Custom SVG icons
│   ├── folder-remote-connected-symbolic.svg
│   └── folder-remote-disconnected-symbolic.svg
└── README.md
```

### Quick Install

Clone the repository or download the branch from github. A comprehensive Makefile is included.

```bash
git clone https://github.com/gavindi/network-automount
cd network-automount
make install
```

##### Build Process

The Makefile automatically handles:
- Compiling GSettings schemas (required for preferences)
- Copying all necessary files including custom icons
- Creating proper directory structure in build/
- Installing icons directory with all SVG files
- Validating all required files are present

##### Installation Options

```bash
# Install to user directory (recommended)
make install

# System-wide installation (requires sudo)
make install-system

# Validate all required files are present
make validate
```

##### Development Workflow

```bash
# One command to clean, build, install, and enable
make dev

# Check if extension is installed/enabled
make status

# Restart GNOME Shell on X11
make restart-shell

# Watch for file changes and auto-rebuild
make watch

# View extension logs
make logs
```

##### Distribution

```bash
# Creates a zip file for sharing/publishing
make dist
```

##### Icon Management

The extension includes custom SVG icons that provide visual feedback:
- **🟢 Connected state**: Green indicator when all enabled network shares are mounted
- **🔴 Mounting/Disconnected state**: Red indicator during mounting or when shares are disconnected
- **🎨 UI Integration**: Custom connected icon appears in preferences About page for consistent branding

Icons are automatically copied during installation. If custom icons are missing, the extension gracefully falls back to standard GNOME icons.

##### Quick Usage

```bash
# Build and install the extension
make install

# Enable it
make enable

# Or do everything at once for development
make dev

# Check status and view logs
make status
make logs
```

##### Additional Makefile Targets

```bash
make help           # Show all available commands
make validate       # Check all required files exist
make reload         # Disable and re-enable extension
make quick          # Quick install and status check
make uninstall      # Remove extension from user directory
make clean          # Clean build directory
```

## Visual Status Indicators

The extension provides clear visual feedback through custom panel icons and consistent UI branding:

### Icon States
- **🟢 All Connected**: Green dot indicator when all enabled bookmarks are mounted
- **🔴 Mounting/Issues**: Red dot with X when mounting is in progress or shares are disconnected
- **⚪ Default**: Standard folder icon when no bookmarks are configured

### Custom Icons
The extension uses SVG icons that automatically adapt to your GNOME theme:
- `folder-remote-connected-symbolic.svg` - Connected state (used in panel and preferences)
- `folder-remote-disconnected-symbolic.svg` - Disconnected/mounting state

### UI Integration
- **Panel Indicator**: Real-time status updates during mount operations
- **Preferences About Page**: Custom connected icon for consistent branding
- **Automatic Fallback**: Gracefully falls back to system icons if custom SVGs are missing

# Step-by-Step Custom Mount Points Setup

## Scenario: Setting up a home network with NAS access

**Goal**: Access your NAS shares easily from `~/NetworkMounts/` folder

---

## Step 1: Add Network Bookmarks First

Before configuring the extension, you need network bookmarks in your file manager:

1. **Open Files (Nautilus)**
2. **Connect to Server** (Ctrl+L or sidebar)
3. **Enter your network addresses**:
   ```
   smb://192.168.1.100/documents
   smb://192.168.1.100/media  
   smb://192.168.1.100/backup
   ```
4. **Authenticate** when prompted
5. **Bookmark each share** (Ctrl+D or click bookmark star)

**Verify**: Check that bookmarks appear in Files sidebar

---

## Step 2: Configure Base Directory

1. **Open Extension Settings**:
   ```bash
   gnome-extensions prefs network-automount@gavindi.github.com
   ```
   
2. **Go to "Mount Points" tab**

3. **Set Base Mount Directory**:
   ```
   /home/[username]/NetworkMounts
   ```
   Or simply: `~/NetworkMounts`

4. **Click browse button** (📁) if you prefer visual selection

**Result**: All symlinks will be created under `~/NetworkMounts/`

---

## Step 3: Configure Each Bookmark

Go to **"Bookmarks" tab** - you should see your network bookmarks listed.

### For Documents Share:
```
📋 192.168.1.100/documents
├── ☑️ Auto Mount: ON
├── ☑️ Create Symlink: ON
├── 📝 Symlink Name: "NAS-Documents"
└── Custom Mount Point: [leave empty]
```

### For Media Share:
```
📋 192.168.1.100/media
├── ☑️ Auto Mount: ON  
├── ☑️ Create Symlink: ON
├── 📝 Symlink Name: "NAS-Media"
└── Custom Mount Point: [leave empty]
```

### For Backup Share:
```
📋 192.168.1.100/backup
├── ☑️ Auto Mount: ON
├── ☑️ Create Symlink: ON  
├── 📝 Symlink Name: "NAS-Backup"
└── Custom Mount Point: [leave empty]
```

**Click "Apply" or close settings**

---

## Step 4: Test the Setup

1. **Wait 10-15 seconds** for auto-mounting

2. **Check the status**:
   - Extension icon in top bar should show connected state (🟢)
   - Click extension icon to see mount status

3. **Verify symlinks created**:
   ```bash
   ls -la ~/NetworkMounts/
   ```
   Should show:
   ```
   lrwxrwxrwx NAS-Documents -> /run/user/1000/gvfs/smb-share:server=192.168.1.100,share=documents
   lrwxrwxrwx NAS-Media -> /run/user/1000/gvfs/smb-share:server=192.168.1.100,share=media  
   lrwxrwxrwx NAS-Backup -> /run/user/1000/gvfs/smb-share:server=192.168.1.100,share=backup
   ```

4. **Test access**:
   ```bash
   cd ~/NetworkMounts/NAS-Documents
   ls
   ```

---

## Step 5: Use Your Network Shares

### In File Manager:
- Navigate to **~/NetworkMounts/**
- Double-click **NAS-Documents**, **NAS-Media**, etc.
- Bookmark `~/NetworkMounts/` for quick access

### In Applications:
- **Media Player**: Open `~/NetworkMounts/NAS-Media/Movies/`
- **Document Editor**: Open files from `~/NetworkMounts/NAS-Documents/`
- **Backup Software**: Backup to `~/NetworkMounts/NAS-Backup/`

### In Terminal:
```bash
# Navigate to shares
cd ~/NetworkMounts/NAS-Documents

# Use in scripts  
rsync -av ~/Documents/ ~/NetworkMounts/NAS-Backup/Documents/

# Check disk usage
df -h ~/NetworkMounts/NAS-Media
```

---

## Step 6: Verification & Troubleshooting

### Check Extension Status:
```bash
gnome-extensions list --enabled | grep network-automount
make status  # If using Makefile
```

### Check Mount Status:
```bash
gio mount -l | grep smb
```

### Check Symlinks:
```bash
find ~/NetworkMounts -type l -ls
```

### If Something's Wrong:

1. **No symlinks**: Check "Create Symlink" is enabled
2. **Permission errors**: Ensure `~/NetworkMounts` is writable
3. **Broken symlinks**: Unmount/remount shares via extension menu
4. **Shares not mounting**: Check network connectivity and credentials
5. **Icons not showing**: Check if custom SVG files are installed

### Force Refresh:
1. Click extension icon → "Check All Now"
2. Or disable/enable extension:
   ```bash
   gnome-extensions disable network-automount@gavindi.github.com
   gnome-extensions enable network-automount@gavindi.github.com
   ```

### Debug Commands:
```bash
# View extension logs
make logs

# Validate installation
make validate

# Rebuild if needed
make clean
make dev
```

---

## Success! 🎉

You now have:
- ✅ Automatic mounting of network shares
- ✅ Easy access via `~/NetworkMounts` 
- ✅ Custom names for each share
- ✅ Visual status indicators
- ✅ Integration with all applications

### Next Steps:
- Add desktop shortcuts: `ln -s ~/NetworkMounts/NAS-Media ~/Desktop/Media`
- Configure backup scripts using the symlink paths
- Add more network shares as needed

**Pro Tip**: The extension will automatically recreate symlinks after reboots, network changes, or credential updates!

## Advanced Features

### Retry Mechanism
- Configurable retry attempts for failed mounts
- Adjustable delay between retry attempts
- Visual feedback for retry status

### Notification System
- Granular notification controls
- Success/error notification toggles
- Transient notifications that don't clutter your desktop

### Performance Optimizations
- File monitoring for bookmarks instead of periodic disk reads
- Efficient mount status checking
- Reduced battery usage on laptops

### Per-Bookmark Configuration
- Individual auto-mount settings
- Custom symlink paths
- Independent symlink creation (works even without auto-mount)

## Manual Installation (Without Makefile)

If you prefer manual installation:

1. **Create extension directory**:
   ```bash
   mkdir -p ~/.local/share/gnome-shell/extensions/network-share-automount@gavindi.github.com
   cd ~/.local/share/gnome-shell/extensions/network-share-automount@gavindi.github.com
   ```

2. **Copy source files**:
   ```bash
   cp extension.js .
   cp prefs.js .
   cp metadata.json .
   ```

3. **Copy and compile schemas**:
   ```bash
   mkdir schemas
   cp schemas/org.gnome.shell.extensions.network-share-automount.gschema.xml schemas/
   glib-compile-schemas schemas/
   ```

4. **Copy icons directory**:
   ```bash
   cp -r icons .
   ```

5. **Enable extension**:
   ```bash
   gnome-extensions enable network-share-automount@gavindi.github.com
   ```

## Troubleshooting

### Common Issues

**Extension not loading:**
```bash
# Check logs for errors
journalctl -f -o cat /usr/bin/gnome-shell | grep -i network

# Validate installation
make validate
```

**Icons not appearing:**
```bash
# Check if icons were copied
ls -la ~/.local/share/gnome-shell/extensions/network-share-automount@gavindi.github.com/icons/

# Check permissions
find ~/.local/share/gnome-shell/extensions/network-share-automount@gavindi.github.com -name "*.svg" -ls

# Test preferences icon loading
gnome-extensions prefs network-share-automount@gavindi.github.com
# Check About page for custom icon
```

**Mounts failing:**
- Check network connectivity
- Verify credentials in file manager first
- Check if shares are accessible manually
- Review notification messages for specific errors

**Icons not showing in preferences:**
- Check if `icons/folder-remote-connected-symbolic.svg` exists in extension directory
- Verify file permissions are readable
- Extension automatically falls back to system icons if custom ones are missing

**Symlinks not working:**
- Ensure base directory exists and is writable
- Check that "Create Symlink" is enabled for specific bookmarks
- Verify mount points are valid

### Debug Commands

```bash
# Complete extension status
make status

# Live log monitoring
make logs

# Reinstall with clean state
make uninstall
make clean
make install

# Quick validation
make validate
```

## Bug Reporting

Bugs should be reported to the Github bug tracker [https://github.com/gavindi/network-automount/issues](https://github.com/gavindi/network-automount/issues).

When reporting bugs, please include:
- Extension version (check `metadata.json`)
- GNOME Shell version
- Output of `make validate`
- Relevant log entries from `make logs`
- Steps to reproduce the issue

## License
Network Automount Gnome Shell extension is distributed under the terms of the GNU General Public License, version 2. See the LICENSE file for details.

## Changelog

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