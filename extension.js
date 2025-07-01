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
            style_class: 'system-status-icon'
        });
        this.add_child(this._icon);
        
        // Performance optimizations - Caching
        this._mountStatusCache = new Map(); // uri -> {status: boolean, timestamp: number}
        this._cacheTimeoutMs = 2000; // 2 second cache
        this._currentIconState = null; // 'connected', 'disconnected', 'mounting', 'default'
        
        // Performance optimizations - Debounced updates
        this._pendingUpdates = new Set();
        this._updateDebounceTimeoutId = null;
        
        // Performance optimizations - Settings caching
        this._cachedSettings = {
            checkInterval: settings.get_int('check-interval'),
            showNotifications: settings.get_boolean('show-notifications'),
            showSuccessNotifications: settings.get_boolean('show-success-notifications'),
            showErrorNotifications: settings.get_boolean('show-error-notifications'),
            customMountBase: settings.get_string('custom-mount-base'),
            retryAttempts: settings.get_int('retry-attempts'),
            retryDelay: settings.get_int('retry-delay')
        };
        
        // Performance monitoring
        this._performanceMetrics = {
            mountOperations: [],
            statusChecks: [],
            lastCleanup: Date.now()
        };
        
        // Settings connections tracking
        this._settingsConnections = new Set();
        
        // Load custom icons
        this._loadCustomIcons();
        
        this._bookmarks = [];
        this._mountedLocations = new Map();
        this._symlinkPaths = new Map(); // Track symlinks for cleanup
        this._retryQueue = new Map();
        this._timeoutId = null;
        this._timeoutIds = new Set(); // Track all timeout IDs for cleanup
        this._source = null;
        this._startupMountInProgress = false;
        this._mountingInProgress = false; // Track mounting state for icon updates
        this._bookmarkMenuItems = new Map(); // Track submenu items for updates
        
        // File monitoring for bookmarks
        this._bookmarksFileMonitor = null;
        this._bookmarksFile = null;
        this._bookmarksReloadTimeoutId = null;
        
        // Batch operations
        this._symlinkOperationQueue = [];
        this._symlinkBatchTimeoutId = null;
        
        this._connectSettings();
        this._buildMenu();
        this._setupBookmarksFileMonitoring();
        this._loadBookmarks(); // Initial load
        this._startPeriodicCheck();
        this._setupNotificationSource();
        
        // Mount all enabled bookmarks on startup with status updates
        this._startupMountInProgress = true;
        this._mountingInProgress = true;
        this._updateIconState(); // Set mounting icon initially
        
        const startupTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            this._checkAndMountAll(false, true); // isManual=false, isStartup=true
            this._timeoutIds.delete(startupTimeoutId);
            return GLib.SOURCE_REMOVE;
        });
        this._timeoutIds.add(startupTimeoutId);
        
        // Additional status refresh after startup mounts complete
        const statusTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 10, () => {
            this._startupMountInProgress = false;
            this._mountingInProgress = false;
            this._scheduleStatusUpdate();
            this._timeoutIds.delete(statusTimeoutId);
            return GLib.SOURCE_REMOVE;
        });
        this._timeoutIds.add(statusTimeoutId);
    }
    
    // Performance monitoring
    _trackPerformance(operation, duration) {
        const metric = {
            operation,
            duration,
            timestamp: Date.now()
        };
        
        this._performanceMetrics[operation + 's'] = this._performanceMetrics[operation + 's'] || [];
        this._performanceMetrics[operation + 's'].push(metric);
        
        // Keep only last 100 metrics per operation
        if (this._performanceMetrics[operation + 's'].length > 100) {
            this._performanceMetrics[operation + 's'].shift();
        }
        
        // Log slow operations
        if (duration > 1000) { // > 1 second
            console.warn(`Slow ${operation}: ${duration}ms`);
        }
        
        // Periodic cleanup of old metrics
        const now = Date.now();
        if (now - this._performanceMetrics.lastCleanup > 300000) { // 5 minutes
            Object.keys(this._performanceMetrics).forEach(key => {
                if (Array.isArray(this._performanceMetrics[key])) {
                    this._performanceMetrics[key] = this._performanceMetrics[key].filter(
                        metric => now - metric.timestamp < 300000
                    );
                }
            });
            this._performanceMetrics.lastCleanup = now;
        }
    }
    
    // Debounced UI updates
    _scheduleStatusUpdate(bookmark = null) {
        if (bookmark) {
            this._pendingUpdates.add(bookmark.uri);
        } else {
            this._pendingUpdates.add('__global__');
        }
        
        if (this._updateDebounceTimeoutId) {
            GLib.source_remove(this._updateDebounceTimeoutId);
            this._timeoutIds.delete(this._updateDebounceTimeoutId);
        }
        
        this._updateDebounceTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 150, () => {
            this._processPendingUpdates();
            this._updateDebounceTimeoutId = null;
            this._timeoutIds.delete(this._updateDebounceTimeoutId);
            return GLib.SOURCE_REMOVE;
        });
        this._timeoutIds.add(this._updateDebounceTimeoutId);
    }
    
    _processPendingUpdates() {
        const hasGlobalUpdate = this._pendingUpdates.has('__global__');
        
        if (hasGlobalUpdate) {
            this._updateStatus();
            this._updateBookmarksList();
        } else {
            // Update only specific bookmarks
            this._pendingUpdates.forEach(uri => {
                if (uri !== '__global__') {
                    const bookmark = this._bookmarks.find(b => b.uri === uri);
                    if (bookmark) {
                        this._updateBookmarkSubmenu(bookmark);
                    }
                }
            });
            this._updateStatus(); // Always update overall status
        }
        
        this._pendingUpdates.clear();
    }
    
    _loadCustomIcons() {
        try {
            // Load connected icon
            const connectedIconPath = GLib.build_filenamev([this._extension.path, 'icons', 'folder-remote-connected-symbolic.svg']);
            const connectedFile = Gio.File.new_for_path(connectedIconPath);
            if (connectedFile.query_exists(null)) {
                this._connectedIcon = Gio.FileIcon.new(connectedFile);
            } else {
                console.warn('Connected icon not found, falling back to default');
                this._connectedIcon = null;
            }
            
            // Load disconnected icon
            const disconnectedIconPath = GLib.build_filenamev([this._extension.path, 'icons', 'folder-remote-disconnected-symbolic.svg']);
            const disconnectedFile = Gio.File.new_for_path(disconnectedIconPath);
            if (disconnectedFile.query_exists(null)) {
                this._disconnectedIcon = Gio.FileIcon.new(disconnectedFile);
            } else {
                console.warn('Disconnected icon not found, falling back to default');
                this._disconnectedIcon = null;
            }
            
            // Set initial icon
            this._updateIconState();
            
        } catch (e) {
            console.error('Error loading custom icons:', e);
            this._connectedIcon = null;
            this._disconnectedIcon = null;
            // Fall back to default icon
            this._icon.icon_name = 'folder-remote-symbolic';
        }
    }
    
    // Optimized icon state updates - only change when state actually changes
    _updateIconState() {
        let newState;
        
        if (this._mountingInProgress) {
            newState = 'mounting';
        } else {
            let total = this._bookmarks.length;
            let mounted = this._bookmarks.filter(b => this._isLocationMounted(b.uri, true)).length;
            let enabled = this._bookmarks.filter(b => b.enabled).length;
            
            if (total === 0) {
                newState = 'default';
            } else if (mounted >= enabled) {
                newState = 'connected';
            } else {
                newState = 'disconnected';
            }
        }
        
        // Only update if state actually changed
        if (this._currentIconState === newState) {
            return;
        }
        
        this._currentIconState = newState;
        
        try {
            switch (newState) {
                case 'mounting':
                case 'disconnected':
                    if (this._disconnectedIcon) {
                        this._icon.gicon = this._disconnectedIcon;
                        this._icon.icon_name = null;
                    } else {
                        this._icon.icon_name = 'folder-visiting-symbolic';
                        this._icon.gicon = null;
                    }
                    break;
                case 'connected':
                    if (this._connectedIcon) {
                        this._icon.gicon = this._connectedIcon;
                        this._icon.icon_name = null;
                    } else {
                        this._icon.icon_name = 'folder-remote-symbolic';
                        this._icon.gicon = null;
                    }
                    break;
                default: // 'default'
                    this._icon.icon_name = 'folder-remote-symbolic';
                    this._icon.gicon = null;
                    break;
            }
        } catch (e) {
            console.error('Error updating icon state:', e);
            this._icon.icon_name = 'folder-remote-symbolic';
            this._icon.gicon = null;
        }
    }
    
    // Settings caching and connection tracking
    _connectSettings() {
        const id1 = this._settings.connect('changed::check-interval', () => {
            this._cachedSettings.checkInterval = this._settings.get_int('check-interval');
            this._startPeriodicCheck();
        });
        this._settingsConnections.add(id1);
        
        const id2 = this._settings.connect('changed::show-notifications', () => {
            this._cachedSettings.showNotifications = this._settings.get_boolean('show-notifications');
        });
        this._settingsConnections.add(id2);
        
        const id3 = this._settings.connect('changed::show-success-notifications', () => {
            this._cachedSettings.showSuccessNotifications = this._settings.get_boolean('show-success-notifications');
        });
        this._settingsConnections.add(id3);
        
        const id4 = this._settings.connect('changed::show-error-notifications', () => {
            this._cachedSettings.showErrorNotifications = this._settings.get_boolean('show-error-notifications');
        });
        this._settingsConnections.add(id4);
        
        const id5 = this._settings.connect('changed::custom-mount-base', () => {
            this._cachedSettings.customMountBase = this._settings.get_string('custom-mount-base');
        });
        this._settingsConnections.add(id5);
        
        const id6 = this._settings.connect('changed::retry-attempts', () => {
            this._cachedSettings.retryAttempts = this._settings.get_int('retry-attempts');
        });
        this._settingsConnections.add(id6);
        
        const id7 = this._settings.connect('changed::retry-delay', () => {
            this._cachedSettings.retryDelay = this._settings.get_int('retry-delay');
        });
        this._settingsConnections.add(id7);
        
        const id8 = this._settings.connect('changed::bookmark-settings', () => {
            this._loadBookmarkSettings();
            this._scheduleStatusUpdate();
        });
        this._settingsConnections.add(id8);
    }
    
    _setupBookmarksFileMonitoring() {
        const bookmarksPath = GLib.get_home_dir() + '/.config/gtk-3.0/bookmarks';
        this._bookmarksFile = Gio.File.new_for_path(bookmarksPath);
        
        try {
            this._bookmarksFileMonitor = this._bookmarksFile.monitor_file(
                Gio.FileMonitorFlags.NONE,
                null
            );
            
            this._bookmarksFileMonitor.connect('changed', (monitor, file, otherFile, eventType) => {
                // Only react to changes, creations, and deletions
                if (eventType === Gio.FileMonitorEvent.CHANGED ||
                    eventType === Gio.FileMonitorEvent.CREATED ||
                    eventType === Gio.FileMonitorEvent.DELETED) {
                    
                    console.log('Bookmarks file changed, reloading...');
                    
                    // Debounce rapid file changes with a short delay
                    if (this._bookmarksReloadTimeoutId) {
                        GLib.source_remove(this._bookmarksReloadTimeoutId);
                        this._timeoutIds.delete(this._bookmarksReloadTimeoutId);
                    }
                    
                    this._bookmarksReloadTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                        this._loadBookmarks();
                        this._scheduleStatusUpdate();
                        
                        this._timeoutIds.delete(this._bookmarksReloadTimeoutId);
                        this._bookmarksReloadTimeoutId = null;
                        return GLib.SOURCE_REMOVE;
                    });
                    this._timeoutIds.add(this._bookmarksReloadTimeoutId);
                }
            });
            
            console.log('Set up file monitoring for bookmarks file');
            
        } catch (e) {
            console.error('Failed to set up bookmarks file monitoring:', e);
            console.log('Falling back to periodic bookmark reloading');
        }
    }
    
    _setupNotificationSource() {
        this._source = new MessageTray.Source({
            title: _('Network Share Automount'),
            iconName: 'folder-remote-symbolic'
        });
        Main.messageTray.add(this._source);
    }
    
    // Use cached settings instead of reading from GSettings
    _notify(title, message, isError = false) {
        if (!this._cachedSettings.showNotifications) return;
        
        if (isError && !this._cachedSettings.showErrorNotifications) return;
        if (!isError && !this._cachedSettings.showSuccessNotifications) return;
        
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
        
        let reloadBookmarksItem = new PopupMenu.PopupMenuItem(_('Reload Bookmarks'));
        reloadBookmarksItem.connect('activate', () => {
            this._loadBookmarks();
            this._scheduleStatusUpdate();
            this._notify(_('Bookmarks Reloaded'), _('Bookmarks have been reloaded from file'));
        });
        this.menu.addMenuItem(reloadBookmarksItem);
        
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
        let mounted = this._bookmarks.filter(b => this._isLocationMounted(b.uri, true)).length;
        let enabled = this._bookmarks.filter(b => b.enabled).length;
        let interval = this._cachedSettings.checkInterval;
    
        this._statusItem.label.text = _(`${mounted}/${total} mounted \u2022 Check every ${interval}min`);
    
        // Update icon based on status
        this._updateIconState();
    }
    
    _loadBookmarks() {
        try {
            if (!this._bookmarksFile.query_exists(null)) {
                console.log('Bookmarks file does not exist');
                this._bookmarks = [];
                this._scheduleStatusUpdate();
                return;
            }
            
            let [success, contents] = this._bookmarksFile.load_contents(null);
            if (!success) {
                console.log('Failed to read bookmarks file');
                return;
            }
            
            let bookmarkLines = new TextDecoder().decode(contents).split('\n');
            let newBookmarks = bookmarkLines
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
            
            // Preserve existing status information for bookmarks that still exist
            if (this._bookmarks.length > 0) {
                const existingBookmarksMap = new Map(
                    this._bookmarks.map(b => [b.uri, b])
                );
                
                newBookmarks.forEach(bookmark => {
                    const existing = existingBookmarksMap.get(bookmark.uri);
                    if (existing) {
                        // Preserve runtime state
                        bookmark.enabled = existing.enabled;
                        bookmark.createSymlink = existing.createSymlink;
                        bookmark.symlinkPath = existing.symlinkPath;
                        bookmark.lastAttempt = existing.lastAttempt;
                        bookmark.failCount = existing.failCount;
                    }
                });
            }
            
            this._bookmarks = newBookmarks;
            this._loadBookmarkSettings();
            
            // Clear mount cache when bookmarks change
            this._invalidateMountCache();
            
            console.log(`Loaded ${this._bookmarks.length} network bookmarks`);
            
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
            if (this._isLocationMounted(bookmark.uri, true) && bookmark.createSymlink) {
                this._queueSymlinkOperation('create', bookmark);
            }
            
            // Create collapsible bookmark item with lazy loading
            let submenuItem = this._createBookmarkSubmenu(bookmark, index);
            this._bookmarksSection.addMenuItem(submenuItem);
        });
        
        this._updateStatus();
    }
    
    // Lazy menu population - only populate when opened
    _createBookmarkSubmenu(bookmark, index) {
        let submenuItem = new PopupMenu.PopupSubMenuMenuItem(bookmark.name);
        
        // Store reference for updates
        this._bookmarkMenuItems.set(bookmark.uri, {
            submenu: submenuItem,
            bookmark: bookmark,
            index: index,
            populated: false
        });
        
        this._updateMainItemLabel(submenuItem, bookmark);
        
        // Lazy load submenu content when opened
        submenuItem.menu.connect('open-state-changed', (menu, open) => {
            if (open && !this._bookmarkMenuItems.get(bookmark.uri).populated) {
                this._populateBookmarkSubmenu(submenuItem, bookmark, index);
                this._bookmarkMenuItems.get(bookmark.uri).populated = true;
            }
        });
        
        return submenuItem;
    }
    
    _updateMainItemLabel(submenuItem, bookmark) {
        let isMounted = this._isLocationMounted(bookmark.uri, true);
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
            this._scheduleStatusUpdate();
            this._updateMainItemLabel(submenuItem, bookmark);
        });
        submenu.addMenuItem(autoMountItem);
        
        // Mount status and controls
        let isMounted = this._isLocationMounted(bookmark.uri, true);
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
                this._mountLocationAsync(bookmark);
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
        
        // If submenu is populated, repopulate it with current data
        if (menuData.populated) {
            this._populateBookmarkSubmenu(menuData.submenu, bookmark, menuData.index);
        }
    }
    
    // Mount status caching with TTL
    _isLocationMounted(uri, useCache = true) {
        const startTime = Date.now();
        
        if (useCache) {
            const cached = this._mountStatusCache.get(uri);
            const now = Date.now();
            if (cached && (now - cached.timestamp) < this._cacheTimeoutMs) {
                this._trackPerformance('statusCheck', Date.now() - startTime);
                return cached.status;
            }
        }
        
        try {
            let file = Gio.File.new_for_uri(uri);
            let mount = file.find_enclosing_mount(null);
            const status = mount !== null;
            
            // Cache the result
            this._mountStatusCache.set(uri, {
                status: status,
                timestamp: Date.now()
            });
            
            this._trackPerformance('statusCheck', Date.now() - startTime);
            return status;
        } catch (e) {
            // Cache negative result too
            this._mountStatusCache.set(uri, {
                status: false,
                timestamp: Date.now()
            });
            this._trackPerformance('statusCheck', Date.now() - startTime);
            return false;
        }
    }
    
    // Clear cache when we know status changed
    _invalidateMountCache(uri = null) {
        if (uri) {
            this._mountStatusCache.delete(uri);
        } else {
            this._mountStatusCache.clear();
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
        let basePath = this._cachedSettings.customMountBase;
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
    
    // Batch symlink operations
    _queueSymlinkOperation(operation, bookmark) {
        this._symlinkOperationQueue.push({ operation, bookmark });
        
        if (this._symlinkBatchTimeoutId) {
            return; // Already scheduled
        }
        
        this._symlinkBatchTimeoutId = GLib.idle_add(GLib.PRIORITY_LOW, () => {
            this._processSymlinkQueue();
            return GLib.SOURCE_CONTINUE;
        });
        this._timeoutIds.add(this._symlinkBatchTimeoutId);
    }
    
    _processSymlinkQueue() {
        if (this._symlinkOperationQueue.length === 0) {
            if (this._symlinkBatchTimeoutId) {
                GLib.source_remove(this._symlinkBatchTimeoutId);
                this._timeoutIds.delete(this._symlinkBatchTimeoutId);
                this._symlinkBatchTimeoutId = null;
            }
            return GLib.SOURCE_REMOVE;
        }
        
        const { operation, bookmark } = this._symlinkOperationQueue.shift();
        
        if (operation === 'create') {
            this._createSymlink(bookmark);
        } else if (operation === 'remove') {
            this._removeSymlink(bookmark);
        }
        
        return GLib.SOURCE_CONTINUE;
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
    
    // Utility function for delays in async operations
    _delay(ms) {
        return new Promise(resolve => {
            const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms, () => {
                this._timeoutIds.delete(timeoutId);
                resolve();
                return GLib.SOURCE_REMOVE;
            });
            this._timeoutIds.add(timeoutId);
        });
    }
    
    // Async mount operations
    async _mountLocationAsync(bookmark, isRetry = false, isStartup = false) {
        const startTime = Date.now();
        
        if (this._isLocationMounted(bookmark.uri)) {
            await this._createSymlinkAsync(bookmark);
            if (!isRetry && !isStartup) {
                this._notify(_('Already Mounted'), bookmark.name);
            }
            this._trackPerformance('mountOperation', Date.now() - startTime);
            return true;
        }
        
        this._mountingInProgress = true;
        this._updateIconState();
        
        return new Promise((resolve) => {
            try {
                let file = Gio.File.new_for_uri(bookmark.uri);
                let mountOp = new Gio.MountOperation();
                
                file.mount_enclosing_volume(
                    Gio.MountMountFlags.NONE,
                    mountOp,
                    null,
                    async (file, result) => {
                        try {
                            file.mount_enclosing_volume_finish(result);
                            console.log(`Successfully mounted: ${bookmark.name}`);
                            
                            bookmark.failCount = 0;
                            bookmark.lastAttempt = Date.now();
                            this._mountedLocations.set(bookmark.uri, Date.now());
                            this._invalidateMountCache(bookmark.uri);
                            
                            this._mountingInProgress = false;
                            
                            // Wait a moment for mount to be fully available
                            await this._delay(1000);
                            
                            const symlinkCreated = await this._createSymlinkAsync(bookmark);
                            
                            if (!isStartup) {
                                const message = bookmark.createSymlink && symlinkCreated ? 
                                    `${bookmark.name} → ${this._getSymlinkPath(bookmark)}` : 
                                    bookmark.name;
                                this._notify(_('Mounted Successfully'), message);
                            }
                            
                            this._scheduleStatusUpdate(bookmark);
                            this._trackPerformance('mountOperation', Date.now() - startTime);
                            resolve(true);
                            
                        } catch (e) {
                            console.error(`Failed to mount ${bookmark.name}:`, e);
                            this._mountingInProgress = false;
                            this._handleMountFailure(bookmark, e.message);
                            this._trackPerformance('mountOperation', Date.now() - startTime);
                            resolve(false);
                        }
                    }
                );
            } catch (e) {
                console.error(`Error mounting ${bookmark.name}:`, e);
                this._mountingInProgress = false;
                this._handleMountFailure(bookmark, e.message);
                this._trackPerformance('mountOperation', Date.now() - startTime);
                resolve(false);
            }
        });
    }
    
    async _createSymlinkAsync(bookmark) {
        return new Promise((resolve) => {
            // Use batch processing for symlink operations
            this._queueSymlinkOperation('create', bookmark);
            
            // Wait a bit for the operation to complete
            const timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                this._timeoutIds.delete(timeoutId);
                resolve(true);
                return GLib.SOURCE_REMOVE;
            });
            this._timeoutIds.add(timeoutId);
        });
    }
    
    // Legacy sync method for compatibility
    _mountLocation(bookmark, isRetry = false, isStartup = false) {
        this._mountLocationAsync(bookmark, isRetry, isStartup);
    }
    
    _handleMountFailure(bookmark, errorMsg) {
        bookmark.failCount++;
        bookmark.lastAttempt = Date.now();
        
        let maxRetries = this._cachedSettings.retryAttempts;
        if (bookmark.failCount <= maxRetries) {
            // Schedule retry
            let retryDelay = this._cachedSettings.retryDelay;
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
        
        this._scheduleStatusUpdate(bookmark);
    }
    
    _scheduleRetry(bookmark, delaySecs) {
        const retryTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, delaySecs, () => {
            if (bookmark.enabled && !this._isLocationMounted(bookmark.uri)) {
                this._mountLocationAsync(bookmark, true, this._startupMountInProgress);
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
                    this._queueSymlinkOperation('remove', bookmark);
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
                            this._invalidateMountCache(bookmark.uri);
                            this._notify(_('Unmounted'), bookmark.name);
                            
                            this._scheduleStatusUpdate(bookmark);
                            
                        } catch (e) {
                            console.error(`Failed to unmount ${bookmark.name}:`, e);
                            this._notify(_('Unmount Failed'), `${bookmark.name}: ${e.message}`, true);
                        }
                    }
                );
            } else {
                // If not mounted, still try to clean up any stale symlinks
                if (bookmark.createSymlink) {
                    this._queueSymlinkOperation('remove', bookmark);
                }
                this._notify(_('Not Mounted'), bookmark.name);
            }
        } catch (e) {
            console.error(`Error unmounting ${bookmark.name}:`, e);
        }
    }
    
    // PERFORMANCE OPTIMIZATION: This method now only checks mount status,
    // it no longer reloads bookmarks from disk every time
    _checkAndMountAll(manual = false, isStartup = false) {
        let mounted = 0;
        let total = 0;
        
        // Set mounting state if manual or any mounting will occur
        if (manual || isStartup) {
            this._mountingInProgress = true;
            this._updateIconState();
        }
        
        // Only update status, don't reload bookmarks from disk
        this._updateStatus();
        
        // Process ALL bookmarks for symlink management, but only mount enabled ones
        this._bookmarks.forEach(bookmark => {
            if (bookmark.enabled) {
                total++;
                if (this._isLocationMounted(bookmark.uri, true)) {
                    mounted++;
                    // Ensure symlink exists for already mounted locations (if symlink is enabled)
                    if (bookmark.createSymlink) {
                        this._queueSymlinkOperation('create', bookmark);
                    }
                } else {
                    this._mountLocationAsync(bookmark, false, isStartup);
                }
            } else {
                // Even if auto-mount is disabled, check if already mounted and create/update symlink if enabled
                if (this._isLocationMounted(bookmark.uri, true) && bookmark.createSymlink) {
                    this._queueSymlinkOperation('create', bookmark);
                }
            }
        });
        
        // Clear mounting state after a delay to allow mounts to complete
        if (manual || isStartup) {
            const mountingCompleteTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
                this._mountingInProgress = false;
                this._updateStatus();
                this._timeoutIds.delete(mountingCompleteTimeoutId);
                return GLib.SOURCE_REMOVE;
            });
            this._timeoutIds.add(mountingCompleteTimeoutId);
        }
            
        if (manual) {
            this._notify(_('Mount Check'), _(`Checking ${total} locations, ${mounted} already mounted`));
        }
        
        console.log(`Periodic check: ${mounted}/${total} mounted, ${this._bookmarks.length} total bookmarks`);
    }
    
    _mountAllEnabled() {
        let count = 0;
        this._mountingInProgress = true;
        this._updateIconState();
        
        this._bookmarks
            .filter(bookmark => bookmark.enabled)
            .forEach(bookmark => {
                if (!this._isLocationMounted(bookmark.uri, true)) {
                    this._mountLocationAsync(bookmark);
                    count++;
                }
            });
        
        // Clear mounting state after delay
        const mountAllCompleteTimeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            this._mountingInProgress = false;
            this._updateStatus();
            this._timeoutIds.delete(mountAllCompleteTimeoutId);
            return GLib.SOURCE_REMOVE;
        });
        this._timeoutIds.add(mountAllCompleteTimeoutId);
            
        this._notify(_('Mounting All'), _(`Attempting to mount ${count} locations`));
    }
    
    _unmountAll() {
        let count = 0;
        this._bookmarks.forEach(bookmark => {
            if (this._isLocationMounted(bookmark.uri, true)) {
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
        
        let interval = this._cachedSettings.checkInterval;
        this._timeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            interval * 60,
            () => {
                // PERFORMANCE OPTIMIZATION: Only check mount status, don't reload bookmarks
                this._checkAndMountAll();
                return GLib.SOURCE_CONTINUE;
            }
        );
        
        console.log(`Started periodic check with ${interval} minute interval`);
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
                this._queueSymlinkOperation('remove', bookmark);
            }
        });
        this._symlinkPaths.clear();
    }
    
    destroy() {
        // Clean up file monitor
        if (this._bookmarksFileMonitor) {
            this._bookmarksFileMonitor.cancel();
            this._bookmarksFileMonitor = null;
        }
        
        // Remove periodic check timeout
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = null;
        }
        
        // Remove bookmark reload timeout if pending
        if (this._bookmarksReloadTimeoutId) {
            GLib.source_remove(this._bookmarksReloadTimeoutId);
            this._bookmarksReloadTimeoutId = null;
        }
        
        // Clear update debounce timeout
        if (this._updateDebounceTimeoutId) {
            GLib.source_remove(this._updateDebounceTimeoutId);
            this._updateDebounceTimeoutId = null;
        }
        
        // Clear symlink batch timeout
        if (this._symlinkBatchTimeoutId) {
            GLib.source_remove(this._symlinkBatchTimeoutId);
            this._symlinkBatchTimeoutId = null;
        }
        
        // Remove all tracked timeouts
        this._timeoutIds.forEach(timeoutId => {
            GLib.source_remove(timeoutId);
        });
        this._timeoutIds.clear();
        
        // Clean up settings connections
        if (this._settingsConnections) {
            this._settingsConnections.forEach(id => {
                this._settings.disconnect(id);
            });
            this._settingsConnections.clear();
        }
        
        // Clean up all symlinks when extension is disabled
        this._cleanupAllSymlinks();
        
        if (this._source) {
            this._source.destroy();
        }
        
        // Clear all caches
        this._mountStatusCache.clear();
        this._pendingUpdates.clear();
        this._bookmarkMenuItems.clear();
        
        // Nullify references to help GC
        this._cachedSettings = null;
        this._mountStatusCache = null;
        this._pendingUpdates = null;
        this._performanceMetrics = null;
        this._symlinkOperationQueue = null;
        
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