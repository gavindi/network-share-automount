/*
 * Network Share Automount extension for Gnome 45+
 * Copyright 2025 Gavin Graham (gavindi)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 2 (GPLv2)
 * as published by the Free Software Foundation.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 */

import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';
import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

class NetworkMountIndicator extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    _init(settings, extension) {
        super._init(0.0, _('Network Share Automount'));
        
        this._settings = settings;
        this._extension = extension;
        this._icon = new St.Icon({
            icon_name: 'folder-remote-symbolic',
            style_class: 'system-status-icon'
        });
        this.add_child(this._icon);
        
        this._bookmarks = [];
        this._mountedLocations = new Map();
        this._symlinkPaths = new Map(); // Track symlinks for cleanup
        this._retryQueue = new Map();
        this._timeoutId = null;
        this._timeoutIds = new Set(); // Track all timeout IDs for cleanup
        this._source = null;
        this._startupMountInProgress = false;
        this._bookmarkMenuItems = new Map(); // Track submenu items for updates
        
        this._connectSettings();
        this._buildMenu();
        this._loadBookmarks();
        this._startPeriodicCheck();
        this._setupNotificationSource();
        
        // Mount all enabled bookmarks on startup with status updates
        this._startupMountInProgress = true;
        const startupTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            this._checkAndMountAll(false, true); // isManual=false, isStartup=true
            this._timeoutIds.delete(startupTimeoutId);
            return GLib.SOURCE_REMOVE;
        });
        this._timeoutIds.add(startupTimeoutId);
        
        // Additional status refresh after startup mounts complete
        const statusTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, () => {
            this._startupMountInProgress = false;
            this._updateBookmarksList();
            this._updateStatus();
            this._timeoutIds.delete(statusTimeoutId);
            return GLib.SOURCE_REMOVE;
        });
        this._timeoutIds.add(statusTimeoutId);
    }
    
    _connectSettings() {
        this._settings.connect('changed::check-interval', () => {
            this._startPeriodicCheck();
        });
        
        this._settings.connect('changed::bookmark-settings', () => {
            this._loadBookmarkSettings();
            this._updateBookmarksList();
        });
    }
    
    _setupNotificationSource() {
        this._source = new MessageTray.Source({
            title: _('Network Share Automount'),
            iconName: 'folder-remote-symbolic'
        });
        Main.messageTray.add(this._source);
    }
    
    _notify(title, message, isError = false) {
        if (!this._settings.get_boolean('show-notifications')) return;
        
        if (isError && !this._settings.get_boolean('show-error-notifications')) return;
        if (!isError && !this._settings.get_boolean('show-success-notifications')) return;
        
        let notification = new MessageTray.Notification(this._source, title, message);
        notification.setTransient(true);
        if (isError) notification.setUrgency(MessageTray.Urgency.HIGH);
        this._source.showNotification(notification);
    }
    
    _buildMenu() {
        // Header with status
        this._headerItem = new PopupMenu.PopupMenuItem(_('Network Share Automount'), {
            reactive: false,
            style_class: 'popup-menu-item-header'
        });
        this.menu.addMenuItem(this._headerItem);
        
        // Status line
        this._statusItem = new PopupMenu.PopupMenuItem('', {
            reactive: false,
            style_class: 'popup-menu-item-inactive'
        });
        this.menu.addMenuItem(this._statusItem);
        
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // Bookmarks section
        this._bookmarksSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._bookmarksSection);
        
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // Controls
        let configItem = new PopupMenu.PopupMenuItem(_('Settings'));
        configItem.connect('activate', () => {
            this._openSettings();
        });
        this.menu.addMenuItem(configItem);
        
        let refreshItem = new PopupMenu.PopupMenuItem(_('Check All Now'));
        refreshItem.connect('activate', () => {
            this._checkAndMountAll(true);
        });
        this.menu.addMenuItem(refreshItem);
        
        let mountAllItem = new PopupMenu.PopupMenuItem(_('Mount All Enabled'));
        mountAllItem.connect('activate', () => {
            this._mountAllEnabled();
        });
        this.menu.addMenuItem(mountAllItem);
        
        let unmountAllItem = new PopupMenu.PopupMenuItem(_('Unmount All'));
        unmountAllItem.connect('activate', () => {
            this._unmountAll();
        });
        this.menu.addMenuItem(unmountAllItem);
    }

    _updateStatus() {
        let total = this._bookmarks.length;
        let mounted = this._bookmarks.filter(b => this._isLocationMounted(b.uri)).length;
        let enabled = this._bookmarks.filter(b => b.enabled).length;
        let interval = this._settings.get_int('check-interval');
    
        this._statusItem.label.text = _(`${mounted}/${total} mounted \u2022 Check every ${interval}min`);
    
        // Update icon based on status
        if (total === 0) {
            this._icon.icon_name = 'folder-remote-symbolic';
        } else if (mounted >= enabled) {
            this._icon.icon_name = 'folder-remote-symbolic'; // All good
            this._icon.add_style_class_name('success');
        } else if (mounted > 0) {
            this._icon.icon_name = 'folder-visiting-symbolic'; // Partial
        } else {
            this._icon.icon_name = 'folder-visting-symbolic'; // None mounted
        }
    }
    
    _loadBookmarks() {
        try {
            let bookmarksFile = Gio.File.new_for_path(
                GLib.get_home_dir() + '/.config/gtk-3.0/bookmarks'
            );
            
            if (!bookmarksFile.query_exists(null)) {
                this._updateBookmarksList([]);
                return;
            }
            
            let [success, contents] = bookmarksFile.load_contents(null);
            if (!success) return;
            
            let bookmarkLines = new TextDecoder().decode(contents).split('\n');
            this._bookmarks = bookmarkLines
                .filter(line => line.trim() && line.includes('://') && !line.startsWith('file://'))
                .map(line => {
                    let [uri, ...nameParts] = line.trim().split(' ');
                    let name = nameParts.join(' ') || this._extractNameFromUri(uri);
                    return { 
                        uri, 
                        name, 
                        enabled: true,
                        createSymlink: false,
                        symlinkPath: '',
                        lastAttempt: 0,
                        failCount: 0
                    };
                });
                
            this._loadBookmarkSettings();
            this._updateBookmarksList();
            
        } catch (e) {
            console.error('Error loading bookmarks:', e);
            this._bookmarks = [];
        }
    }
    
    _loadBookmarkSettings() {
        try {
            let settingsStr = this._settings.get_string('bookmark-settings');
            if (!settingsStr) return;
            
            let bookmarkSettings = JSON.parse(settingsStr);
            this._bookmarks.forEach(bookmark => {
                let settings = bookmarkSettings[bookmark.uri];
                if (settings) {
                    bookmark.enabled = settings.enabled !== false;
                    bookmark.createSymlink = settings.createSymlink || false;
                    bookmark.symlinkPath = settings.symlinkPath || '';
                }
            });
        } catch (e) {
            console.error('Error loading bookmark settings:', e);
        }
    }
    
    _saveBookmarkSettings() {
        try {
            let bookmarkSettings = {};
            this._bookmarks.forEach(bookmark => {
                bookmarkSettings[bookmark.uri] = {
                    enabled: bookmark.enabled,
                    createSymlink: bookmark.createSymlink,
                    symlinkPath: bookmark.symlinkPath
                };
            });
            
            this._settings.set_string('bookmark-settings', JSON.stringify(bookmarkSettings));
        } catch (e) {
            console.error('Error saving bookmark settings:', e);
        }
    }
    
    _extractNameFromUri(uri) {
        try {
            let parsed = GLib.Uri.parse(uri, GLib.UriFlags.NONE);
            let path = parsed.get_path() || '';
            let host = parsed.get_host() || 'unknown';
            return path.length > 1 ? `${host}${path}` : host;
        } catch (e) {
            return uri;
        }
    }
    
    _updateBookmarksList() {
        this._bookmarksSection.removeAll();
        this._bookmarkMenuItems.clear();
        
        if (this._bookmarks.length === 0) {
            let noBookmarksItem = new PopupMenu.PopupMenuItem(_('No network bookmarks found'), {
                reactive: false,
                style_class: 'popup-menu-item-inactive'
            });
            this._bookmarksSection.addMenuItem(noBookmarksItem);
            this._updateStatus();
            return;
        }
        
        this._bookmarks.forEach((bookmark, index) => {
            // Check and update symlinks only for bookmarks with symlink enabled
            if (this._isLocationMounted(bookmark.uri) && bookmark.createSymlink) {
                this._createSymlink(bookmark);
            }
            
            // Create collapsible bookmark item
            let submenuItem = this._createBookmarkSubmenu(bookmark, index);
            this._bookmarksSection.addMenuItem(submenuItem);
        });
        
        this._updateStatus();
    }
    
    _createBookmarkSubmenu(bookmark, index) {
        // Create the main submenu item
        let submenuItem = new PopupMenu.PopupSubMenuMenuItem(bookmark.name);
        
        // Store reference for updates
        this._bookmarkMenuItems.set(bookmark.uri, {
            submenu: submenuItem,
            bookmark: bookmark,
            index: index
        });
        
        // Update the main item label with status
        this._updateMainItemLabel(submenuItem, bookmark);
        
        // Populate the submenu
        this._populateBookmarkSubmenu(submenuItem, bookmark, index);
        
        return submenuItem;
    }
    
    _updateMainItemLabel(submenuItem, bookmark) {
        let isMounted = this._isLocationMounted(bookmark.uri);
        let statusSymbol = isMounted ? '\u{1f7e2}' : '\u26aa';
        
        if (bookmark.failCount > 0) {
            statusSymbol = '\u{1f7e1}';
        }
        
        // Main label shows just name and status symbol
        submenuItem.label.text = `${statusSymbol} ${bookmark.name}`;
    }
    
    _populateBookmarkSubmenu(submenuItem, bookmark, index) {
        let submenu = submenuItem.menu;
        
        // Clear existing items
        submenu.removeAll();
        
        // Auto-mount toggle
        let autoMountItem = new PopupMenu.PopupSwitchMenuItem(_('Auto Mount'), bookmark.enabled);
        autoMountItem.connect('toggled', (item, state) => {
            this._bookmarks[index].enabled = state;
            this._saveBookmarkSettings();
            this._updateStatus();
            this._updateMainItemLabel(submenuItem, bookmark);
        });
        submenu.addMenuItem(autoMountItem);
        
        // Mount status and controls
        let isMounted = this._isLocationMounted(bookmark.uri);
        if (isMounted) {
            // Show mounted status
            let statusItem = new PopupMenu.PopupMenuItem(_('Status: Mounted'), {
                reactive: false,
                style_class: 'popup-menu-item-inactive'
            });
            submenu.addMenuItem(statusItem);
            
            // Show symlink path if applicable
            if (bookmark.createSymlink) {
                let symlinkPath = this._getSymlinkPath(bookmark);
                let symlinkItem = new PopupMenu.PopupMenuItem(_(`Linked to: ${symlinkPath}`), {
                    reactive: false,
                    style_class: 'popup-menu-item-inactive'
                });
                submenu.addMenuItem(symlinkItem);
            }
            
            // Unmount button
            let unmountItem = new PopupMenu.PopupMenuItem(_('Unmount'));
            unmountItem.connect('activate', () => {
                this._unmountLocation(bookmark);
            });
            submenu.addMenuItem(unmountItem);
            
        } else {
            // Show unmounted status
            let statusText = bookmark.failCount > 0 ? 
                _(`Status: Failed (${bookmark.failCount} attempts)`) : 
                _('Status: Not Mounted');
            
            let statusItem = new PopupMenu.PopupMenuItem(statusText, {
                reactive: false,
                style_class: 'popup-menu-item-inactive'
            });
            submenu.addMenuItem(statusItem);
            
            // Mount button
            let mountItem = new PopupMenu.PopupMenuItem(_('Mount Now'));
            mountItem.connect('activate', () => {
                this._mountLocation(bookmark);
            });
            submenu.addMenuItem(mountItem);
        }
        
        submenu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        
        // Connection details
        let uriItem = new PopupMenu.PopupMenuItem(_(`URI: ${bookmark.uri}`), {
            reactive: false,
            style_class: 'popup-menu-item-inactive'
        });
        submenu.addMenuItem(uriItem);
        
        // Symlink configuration status
        if (bookmark.createSymlink) {
            let symlinkConfigItem = new PopupMenu.PopupMenuItem(_('Symlink: Enabled'), {
                reactive: false,
                style_class: 'popup-menu-item-inactive'
            });
            submenu.addMenuItem(symlinkConfigItem);
        }
    }
    
    _updateBookmarkSubmenu(bookmark) {
        let menuData = this._bookmarkMenuItems.get(bookmark.uri);
        if (!menuData) return;
        
        // Update main label
        this._updateMainItemLabel(menuData.submenu, bookmark);
        
        // Repopulate submenu with current data
        this._populateBookmarkSubmenu(menuData.submenu, bookmark, menuData.index);
    }
    
    _isLocationMounted(uri) {
        try {
            let file = Gio.File.new_for_uri(uri);
            let mount = file.find_enclosing_mount(null);
            return mount !== null;
        } catch (e) {
            return false;
        }
    }
    
    _getGvfsMountPath(uri) {
        try {
            let file = Gio.File.new_for_uri(uri);
            let mount = file.find_enclosing_mount(null);
            if (mount) {
                let root = mount.get_root();
                return root.get_path();
            }
        } catch (e) {
            console.error('Error getting GVFS mount path:', e);
        }
        return null;
    }
    
    _getSymlinkPath(bookmark) {
        let basePath = this._settings.get_string('custom-mount-base');
        if (!basePath) {
            basePath = GLib.get_home_dir() + '/NetworkMounts';
        }
        
        // Use symlinkPath or sanitized bookmark name
        let linkName;
        if (bookmark.symlinkPath) {
            linkName = bookmark.symlinkPath;
        } else {
            linkName = this._sanitizeForFilename(bookmark.name);
        }
        
        return `${basePath}/${linkName}`;
    }
    
    _sanitizeForFilename(name) {
        // Replace problematic characters with safe alternatives
        return name.replace(/[<>:"\/\\|?*]/g, '_')
                  .replace(/\s+/g, '_')
                  .replace(/_+/g, '_')
                  .replace(/^_|_$/g, '');
    }
    
    _createSymlink(bookmark) {
        // Create symlink only if explicitly enabled
        if (!bookmark.createSymlink) {
            return true; // Not an error, just not requested
        }
        
        try {
            let gvfsPath = this._getGvfsMountPath(bookmark.uri);
            if (!gvfsPath) {
                console.error('Could not get GVFS mount path for:', bookmark.name);
                return false;
            }
            
            let symlinkPath = this._getSymlinkPath(bookmark);
            let symlinkDir = GLib.path_get_dirname(symlinkPath);
            
            // Create base directory if it doesn't exist
            let baseDir = Gio.File.new_for_path(symlinkDir);
            try {
                baseDir.make_directory_with_parents(null);
            } catch (e) {
                // Directory might already exist
                if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS)) {
                    console.error('Failed to create symlink directory:', e);
                    return false;
                }
            }
            
            // Remove existing symlink if present
            this._removeSymlink(bookmark);
            
            // Create the symbolic link
            let symlinkFile = Gio.File.new_for_path(symlinkPath);
            try {
                symlinkFile.make_symbolic_link(gvfsPath, null);
                this._symlinkPaths.set(bookmark.uri, symlinkPath);
                console.log(`Created symlink: ${symlinkPath} → ${gvfsPath}`);
                return true;
            } catch (e) {
                console.error(`Failed to create symlink for ${bookmark.name}:`, e);
                return false;
            }
            
        } catch (e) {
            console.error('Error creating symlink:', e);
            return false;
        }
    }
    
    _removeSymlink(bookmark) {
        try {
            let symlinkPath = this._symlinkPaths.get(bookmark.uri);
            if (!symlinkPath) {
                // Try to get the path even if not tracked
                symlinkPath = this._getSymlinkPath(bookmark);
            }
            
            let symlinkFile = Gio.File.new_for_path(symlinkPath);
            if (symlinkFile.query_exists(null)) {
                // Check if it's actually a symlink before removing
                let info = symlinkFile.query_info('standard::is-symlink', Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
                if (info && info.get_is_symlink()) {
                    symlinkFile.delete(null);
                    console.log(`Removed symlink: ${symlinkPath}`);
                }
            }
            
            this._symlinkPaths.delete(bookmark.uri);
            return true;
            
        } catch (e) {
            console.error('Error removing symlink:', e);
            return false;
        }
    }
    
    _mountLocation(bookmark, isRetry = false, isStartup = false) {
        if (this._isLocationMounted(bookmark.uri)) {
            // Even if already mounted, ensure symlink exists if requested
            this._createSymlink(bookmark);
            if (!isRetry && !isStartup) this._notify(_('Already Mounted'), bookmark.name);
            return;
        }
        
        try {
            let file = Gio.File.new_for_uri(bookmark.uri);
            let mountOp = new Gio.MountOperation();
            
            file.mount_enclosing_volume(
                Gio.MountMountFlags.NONE,
                mountOp,
                null,
                (file, result) => {
                    try {
                        file.mount_enclosing_volume_finish(result);
                        console.log(`Successfully mounted: ${bookmark.name}`);
                        
                        bookmark.failCount = 0;
                        bookmark.lastAttempt = Date.now();
                        this._mountedLocations.set(bookmark.uri, Date.now());
                        
                        // Create symlink after successful mount (if requested)
                        const symlinkTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                            let symlinkCreated = this._createSymlink(bookmark);
                            
                            if (!isStartup) {
                                let message = bookmark.createSymlink && symlinkCreated ? 
                                    `${bookmark.name} → ${this._getSymlinkPath(bookmark)}` : 
                                    bookmark.name;
                                this._notify(_('Mounted Successfully'), message);
                            }
                            
                            // Update the specific bookmark submenu
                            this._updateBookmarkSubmenu(bookmark);
                            this._updateStatus();
                            
                            this._timeoutIds.delete(symlinkTimeoutId);
                            return GLib.SOURCE_REMOVE;
                        });
                        this._timeoutIds.add(symlinkTimeoutId);
                        
                    } catch (e) {
                        console.error(`Failed to mount ${bookmark.name}:`, e);
                        this._handleMountFailure(bookmark, e.message);
                    }
                }
            );
        } catch (e) {
            console.error(`Error mounting ${bookmark.name}:`, e);
            this._handleMountFailure(bookmark, e.message);
        }
    }
    
    _handleMountFailure(bookmark, errorMsg) {
        bookmark.failCount++;
        bookmark.lastAttempt = Date.now();
        
        let maxRetries = this._settings.get_int('retry-attempts');
        if (bookmark.failCount <= maxRetries) {
            // Schedule retry
            let retryDelay = this._settings.get_int('retry-delay');
            this._scheduleRetry(bookmark, retryDelay);
            
            this._notify(
                _('Mount Failed - Retrying'), 
                _(`${bookmark.name} (attempt ${bookmark.failCount}/${maxRetries})`), 
                true
            );
        } else {
            this._notify(
                _('Mount Failed'), 
                _(`${bookmark.name}: ${errorMsg}`), 
                true
            );
        }
        
        this._updateBookmarkSubmenu(bookmark);
    }
    
    _scheduleRetry(bookmark, delaySecs) {
        const retryTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delaySecs, () => {
            if (bookmark.enabled && !this._isLocationMounted(bookmark.uri)) {
                this._mountLocation(bookmark, true, this._startupMountInProgress);
            }
            this._timeoutIds.delete(retryTimeoutId);
            return GLib.SOURCE_REMOVE;
        });
        this._timeoutIds.add(retryTimeoutId);
    }
    
    _unmountLocation(bookmark) {
        try {
            let file = Gio.File.new_for_uri(bookmark.uri);
            let mount = file.find_enclosing_mount(null);
            
            if (mount) {
                // Remove symlink before unmounting (if it was created)
                if (bookmark.createSymlink) {
                    this._removeSymlink(bookmark);
                }
                
                mount.unmount_with_operation(
                    Gio.MountUnmountFlags.NONE,
                    null,
                    null,
                    (mount, result) => {
                        try {
                            mount.unmount_with_operation_finish(result);
                            console.log(`Successfully unmounted: ${bookmark.name}`);
                            
                            this._mountedLocations.delete(bookmark.uri);
                            this._notify(_('Unmounted'), bookmark.name);
                            
                            // Update the specific bookmark submenu
                            this._updateBookmarkSubmenu(bookmark);
                            this._updateStatus();
                            
                        } catch (e) {
                            console.error(`Failed to unmount ${bookmark.name}:`, e);
                            this._notify(_('Unmount Failed'), `${bookmark.name}: ${e.message}`, true);
                        }
                    }
                );
            } else {
                // If not mounted, still try to clean up any stale symlinks
                if (bookmark.createSymlink) {
                    this._removeSymlink(bookmark);
                }
                this._notify(_('Not Mounted'), bookmark.name);
            }
        } catch (e) {
            console.error(`Error unmounting ${bookmark.name}:`, e);
        }
    }
    
    _checkAndMountAll(manual = false, isStartup = false) {
        let mounted = 0;
        let total = 0;
        this._loadBookmarks();
        this._updateStatus();
        
        // Process ALL bookmarks for symlink management, but only mount enabled ones
        this._bookmarks.forEach(bookmark => {
            if (bookmark.enabled) {
                total++;
                if (this._isLocationMounted(bookmark.uri)) {
                    mounted++;
                    // Ensure symlink exists for already mounted locations (if symlink is enabled)
                    if (bookmark.createSymlink) {
                        this._createSymlink(bookmark);
                    }
                } else {
                    this._mountLocation(bookmark, false, isStartup);
                }
            } else {
                // Even if auto-mount is disabled, check if already mounted and create/update symlink if enabled
                if (this._isLocationMounted(bookmark.uri) && bookmark.createSymlink) {
                    this._createSymlink(bookmark);
                }
            }
        });
            
        if (manual) {
            this._notify(_('Mount Check'), _(`Checking ${total} locations, ${mounted} already mounted`));
        }
    }
    
    _mountAllEnabled() {
        let count = 0;
        this._bookmarks
            .filter(bookmark => bookmark.enabled)
            .forEach(bookmark => {
                if (!this._isLocationMounted(bookmark.uri)) {
                    this._mountLocation(bookmark);
                    count++;
                }
            });
            
        this._notify(_('Mounting All'), _(`Attempting to mount ${count} locations`));
    }
    
    _unmountAll() {
        let count = 0;
        this._bookmarks.forEach(bookmark => {
            if (this._isLocationMounted(bookmark.uri)) {
                this._unmountLocation(bookmark);
                count++;
            }
        });
        
        this._notify(_('Unmounting All'), _(`Unmounting ${count} locations`));
    }
    
    _startPeriodicCheck() {
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        
        let interval = this._settings.get_int('check-interval');
        this._timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            interval * 60,
            () => {
                this._checkAndMountAll();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }
    
    _openSettings() {
        try {
            this._extension.openPreferences();
        } catch (e) {
            this._notify(_('Settings'), _('Could not open preferences'), true);
        }
    }
    
    _cleanupAllSymlinks() {
        // Clean up all tracked symlinks for ALL bookmarks (not just enabled ones)
        this._bookmarks.forEach(bookmark => {
            if (bookmark.createSymlink) {
                this._removeSymlink(bookmark);
            }
        });
        this._symlinkPaths.clear();
    }
    
    destroy() {
        // Remove periodic check timeout
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        
        // Remove all tracked timeouts
        this._timeoutIds.forEach(timeoutId => {
            GLib.source_remove(timeoutId);
        });
        this._timeoutIds.clear();
        
        // Clean up all symlinks when extension is disabled
        this._cleanupAllSymlinks();
        
        if (this._source) {
            this._source.destroy();
        }
        
        this._bookmarkMenuItems.clear();
        super.destroy();
    }
}

export default class NetworkShareAutomountExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._indicator = new NetworkMountIndicator(this._settings, this);
        Main.panel.addToStatusArea('network-share-automount', this._indicator);
    }
    
    disable() {
        if (this._indicator) {
            this._indicator.destroy();
            this._indicator = null;
        }
        this._settings = null;
    }
}