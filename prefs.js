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

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class NetworkShareAutomountPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        
        // General Settings Page
        const generalPage = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic'
        });
        
        this._addGeneralSettings(generalPage, settings);
        window.add(generalPage);
        
        // Notifications Page
        const notificationsPage = new Adw.PreferencesPage({
            title: _('Notifications'),
            icon_name: 'preferences-desktop-notifications-symbolic'
        });
        
        this._addNotificationSettings(notificationsPage, settings);
        window.add(notificationsPage);
        
        // Mount Points Page
        const mountsPage = new Adw.PreferencesPage({
            title: _('Mount Point'),
            icon_name: 'folder-symbolic'
        });
        
        this._addMountSettings(mountsPage, settings, window);
        window.add(mountsPage);
        
        // Bookmarks Configuration Page
        const bookmarksPage = new Adw.PreferencesPage({
            title: _('Network Shares'),
            icon_name: 'user-bookmarks-symbolic'
        });
        
        this._addBookmarkSettings(bookmarksPage, settings, window);
        window.add(bookmarksPage);
        
        // Advanced Page
        const advancedPage = new Adw.PreferencesPage({
            title: _('Advanced'),
            icon_name: 'preferences-other-symbolic'
        });
        
        this._addAdvancedSettings(advancedPage, settings, window);
        window.add(advancedPage);
        
        // About Page
        const aboutPage = new Adw.PreferencesPage({
            title: _('About'),
            icon_name: 'folder-remote-symbolic'
        });
        
        this._addAboutSettings(aboutPage);
        window.add(aboutPage);
    }
    
    _loadBookmarks() {
        try {
            let bookmarksFile = Gio.File.new_for_path(
                GLib.get_home_dir() + '/.config/gtk-3.0/bookmarks'
            );
            
            if (!bookmarksFile.query_exists(null)) {
                return [];
            }
            
            let [success, contents] = bookmarksFile.load_contents(null);
            if (!success) return [];
            
            let bookmarkLines = new TextDecoder().decode(contents).split('\n');
            return bookmarkLines
                .filter(line => line.trim() && line.includes('://') && !line.startsWith('file://'))
                .map(line => {
                    let [uri, ...nameParts] = line.trim().split(' ');
                    let name = nameParts.join(' ') || this._extractNameFromUri(uri);
                    return { 
                        uri, 
                        name, 
                        enabled: true,
                        createSymlink: false,
                        symlinkPath: ''
                    };
                });
                
        } catch (e) {
            console.error('Error loading bookmarks:', e);
            return [];
        }
    }
    
    _loadBookmarkSettings(bookmarks, settings) {
        try {
            let settingsStr = settings.get_string('bookmark-settings');
            if (!settingsStr) return bookmarks;
            
            let bookmarkSettings = JSON.parse(settingsStr);
            bookmarks.forEach(bookmark => {
                let storedSettings = bookmarkSettings[bookmark.uri];
                if (storedSettings) {
                    bookmark.enabled = storedSettings.enabled !== false;
                    bookmark.createSymlink = storedSettings.createSymlink || false;
                    bookmark.symlinkPath = storedSettings.symlinkPath || '';
                }
            });
            
            return bookmarks;
        } catch (e) {
            console.error('Error loading bookmark settings:', e);
            return bookmarks;
        }
    }
    
    _saveBookmarkSettings(bookmarks, settings) {
        try {
            let bookmarkSettings = {};
            bookmarks.forEach(bookmark => {
                bookmarkSettings[bookmark.uri] = {
                    enabled: bookmark.enabled,
                    createSymlink: bookmark.createSymlink,
                    symlinkPath: bookmark.symlinkPath
                };
            });
            
            settings.set_string('bookmark-settings', JSON.stringify(bookmarkSettings));
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
    
    _sanitizeForFilename(name) {
        return name.replace(/[<>:"\/\\|?*]/g, '_')
                  .replace(/\s+/g, '_')
                  .replace(/_+/g, '_')
                  .replace(/^_|_$/g, '');
    }
    
    _addGeneralSettings(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Automatic Mounting'),
            description: _('Configure how often to check and mount network locations')
        });
        
        // Check interval
        const intervalRow = new Adw.SpinRow({
            title: _('Check Interval'),
            subtitle: _('Minutes between automatic mount checks'),
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 60,
                step_increment: 1,
                page_increment: 5,
                value: settings.get_int('check-interval')
            })
        });
        
        intervalRow.connect('notify::value', () => {
            settings.set_int('check-interval', intervalRow.get_value());
        });
        
        group.add(intervalRow);
        page.add(group);
    }
    
    _addNotificationSettings(page, settings) {
        const group = new Adw.PreferencesGroup({
            title: _('Notification Preferences'),
            description: _('Choose when to show notifications')
        });
        
        // Master notifications toggle
        const notificationsRow = new Adw.SwitchRow({
            title: _('Show Notifications'),
            subtitle: _('Enable or disable all notifications')
        });
        
        settings.bind('show-notifications', notificationsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(notificationsRow);
        
        // Success notifications
        const successRow = new Adw.SwitchRow({
            title: _('Success Notifications'),
            subtitle: _('Show notifications when mounts succeed')
        });
        
        settings.bind('show-success-notifications', successRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(successRow);
        
        // Error notifications
        const errorRow = new Adw.SwitchRow({
            title: _('Error Notifications'),
            subtitle: _('Show notifications when mounts fail')
        });
        
        settings.bind('show-error-notifications', errorRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        group.add(errorRow);
        
        page.add(group);
    }
    
    _addMountSettings(page, settings, window) {
        const group = new Adw.PreferencesGroup({
            title: _('Symlink Configuration'),
            description: _('Configure symlink base directory - symlinks work for all mounted locations regardless of auto-mount setting')
        });
        
        // Symlink base directory
        const mountBaseRow = new Adw.EntryRow({
            title: _('Base Symlink Directory'),
            text: settings.get_string('custom-mount-base')
        });
        
        mountBaseRow.connect('notify::text', () => {
            settings.set_string('custom-mount-base', mountBaseRow.get_text());
        });
        
        // Add browse button
        const browseButton = new Gtk.Button({
            icon_name: 'folder-open-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Browse for directory')
        });
        
        browseButton.connect('clicked', () => {
            this._chooseMountDirectory(mountBaseRow, window);
        });
        
        mountBaseRow.add_suffix(browseButton);
        group.add(mountBaseRow);
        
        // Info about default behavior
        const infoRow = new Adw.ActionRow({
            title: _('Default Behavior'),
            subtitle: _('If empty, defaults to ~/NetworkMounts for symlinks')
        });
        group.add(infoRow);
        
        // Example row
        const exampleRow = new Adw.ActionRow({
            title: _('Example'),
            subtitle: _('~/symlinks or /media/symlinks')
        });
        group.add(exampleRow);
        
        page.add(group);
    }
    
    _addBookmarkSettings(page, settings, window) {
        const bookmarks = this._loadBookmarkSettings(this._loadBookmarks(), settings);
        
        if (bookmarks.length === 0) {
            const noBookmarksGroup = new Adw.PreferencesGroup({
                title: _('No Network Bookmarks Found'),
                description: _('Add network locations to your file manager bookmarks to configure them here')
            });
            
            const infoRow = new Adw.ActionRow({
                title: _('How to add bookmarks'),
                subtitle: _('Open Files, connect to a server (smb://, ftp://, etc.), then bookmark it')
            });
            noBookmarksGroup.add(infoRow);
            page.add(noBookmarksGroup);
            return;
        }
        
        bookmarks.forEach((bookmark, index) => {
            const group = new Adw.PreferencesGroup({
                title: bookmark.name,
                description: bookmark.uri
            });
            
            // Enable/disable auto-mount
            const enableRow = new Adw.SwitchRow({
                title: _('Auto Mount'),
                subtitle: _('Automatically mount this location on startup and periodic checks')
            });
            
            enableRow.set_active(bookmark.enabled);
            enableRow.connect('notify::active', () => {
                bookmarks[index].enabled = enableRow.get_active();
                this._saveBookmarkSettings(bookmarks, settings);
            });
            group.add(enableRow);
            
            // Create symlink option
            const symlinkRow = new Adw.SwitchRow({
                title: _('Create Symlink'),
                subtitle: _('Create a symbolic link when mounted (works independently of auto-mount)')
            });
            
            symlinkRow.set_active(bookmark.createSymlink);
            symlinkRow.connect('notify::active', () => {
                bookmarks[index].createSymlink = symlinkRow.get_active();
                this._saveBookmarkSettings(bookmarks, settings);
                // Enable/disable the symlink path row and hint
                symlinkPathRow.set_sensitive(symlinkRow.get_active());
                symlinkHintRow.set_sensitive(symlinkRow.get_active());
            });
            group.add(symlinkRow);
            
            // Symlink path
            const symlinkPathRow = new Adw.EntryRow({
                title: _('Symlink Name'),
                text: bookmark.symlinkPath
            });
            
            symlinkPathRow.set_sensitive(bookmark.createSymlink);
            
            symlinkPathRow.connect('notify::text', () => {
                bookmarks[index].symlinkPath = symlinkPathRow.get_text();
                this._saveBookmarkSettings(bookmarks, settings);
            });
            group.add(symlinkPathRow);
            
            // Add hint row for default value
            const symlinkHintRow = new Adw.ActionRow({
                title: _('Default: ') + this._sanitizeForFilename(bookmark.name)
            });
            symlinkHintRow.set_sensitive(bookmark.createSymlink);
            group.add(symlinkHintRow);
            
            page.add(group);
        });
        
        // Refresh button
        const refreshGroup = new Adw.PreferencesGroup();
        const refreshRow = new Adw.ActionRow({
            title: _('Refresh Bookmarks'),
            subtitle: _('Reload bookmarks from file manager')
        });
        
        const refreshButton = new Gtk.Button({
            label: _('Refresh'),
            valign: Gtk.Align.CENTER
        });
        
        refreshButton.connect('clicked', () => {
            // Close and reopen to refresh bookmarks
            window.close();
        });
        
        refreshRow.add_suffix(refreshButton);
        refreshGroup.add(refreshRow);
        page.add(refreshGroup);
    }
    
    _addAdvancedSettings(page, settings, window) {
        const retryGroup = new Adw.PreferencesGroup({
            title: _('Retry Settings'),
            description: _('Configure retry behavior for failed mounts')
        });
        
        // Retry attempts
        const attemptsRow = new Adw.SpinRow({
            title: _('Retry Attempts'),
            subtitle: _('Number of times to retry failed mounts'),
            adjustment: new Gtk.Adjustment({
                lower: 0,
                upper: 10,
                step_increment: 1,
                page_increment: 1,
                value: settings.get_int('retry-attempts')
            })
        });
        
        attemptsRow.connect('notify::value', () => {
            settings.set_int('retry-attempts', attemptsRow.get_value());
        });
        
        retryGroup.add(attemptsRow);
        
        // Retry delay
        const delayRow = new Adw.SpinRow({
            title: _('Retry Delay'),
            subtitle: _('Seconds to wait between retry attempts'),
            adjustment: new Gtk.Adjustment({
                lower: 5,
                upper: 300,
                step_increment: 5,
                page_increment: 30,
                value: settings.get_int('retry-delay')
            })
        });
        
        delayRow.connect('notify::value', () => {
            settings.set_int('retry-delay', delayRow.get_value());
        });
        
        retryGroup.add(delayRow);
        page.add(retryGroup);
        
        // Debug group
        const debugGroup = new Adw.PreferencesGroup({
            title: _('Debugging'),
            description: _('Tools for troubleshooting')
        });
        
        const logRow = new Adw.ActionRow({
            title: _('View Extension Logs'),
            subtitle: _('Open journal to view extension debug output')
        });
        
        const logButton = new Gtk.Button({
            label: _('Open Logs'),
            valign: Gtk.Align.CENTER
        });
        
        logButton.connect('clicked', () => {
            try {
                GLib.spawn_command_line_async('gnome-logs');
            } catch (e) {
                console.error('Could not open logs:', e);
            }
        });
        
        logRow.add_suffix(logButton);
        debugGroup.add(logRow);
        
        // Reset settings button
        const resetRow = new Adw.ActionRow({
            title: _('Reset Settings'),
            subtitle: _('Reset all settings to default values')
        });
        
        const resetButton = new Gtk.Button({
            label: _('Reset'),
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action']
        });
        
        resetButton.connect('clicked', () => {
            this._resetSettings(settings, window);
        });
        
        resetRow.add_suffix(resetButton);
        debugGroup.add(resetRow);
        page.add(debugGroup);
    }
    
    _chooseMountDirectory(entry, window) {
        const dialog = new Gtk.FileChooserDialog({
            title: _('Choose Symlink Base Directory'),
            action: Gtk.FileChooserAction.SELECT_FOLDER,
            modal: true,
            transient_for: window
        });
        
        dialog.add_button(_('Cancel'), Gtk.ResponseType.CANCEL);
        dialog.add_button(_('Select'), Gtk.ResponseType.ACCEPT);
        
        // Set initial directory to current value or home directory
        const currentPath = entry.get_text();
        if (currentPath) {
            try {
                const currentFile = Gio.File.new_for_path(currentPath);
                if (currentFile.query_exists(null)) {
                    dialog.set_current_folder(currentFile);
                }
            } catch (e) {
                // If current path is invalid, fall back to home directory
                dialog.set_current_folder(Gio.File.new_for_path(GLib.get_home_dir()));
            }
        } else {
            dialog.set_current_folder(Gio.File.new_for_path(GLib.get_home_dir()));
        }
        
        dialog.connect('response', (dialog, response) => {
            if (response === Gtk.ResponseType.ACCEPT) {
                const file = dialog.get_file();
                if (file) {
                    entry.set_text(file.get_path());
                    // Trigger the notify signal to save the setting
                    entry.notify('text');
                }
            }
            dialog.destroy();
        });
        
        dialog.present();
    }
    
    _addAboutSettings(page) {
        const aboutGroup = new Adw.PreferencesGroup({
            title: _('Network Share Automount'),
            description: _('Automatically mount bookmarked network locations with advanced configuration')
        });
        
        // Extension info
        const extensionInfoRow = new Adw.ActionRow({
            title: _('Network Share Automount'),
            subtitle: _('© 2025 Gavin Graham, Released under GPLv2')
        });
        
        // Try to load custom icon, fall back to default if not available
        const extensionIcon = new Gtk.Image({
            pixel_size: 48,
            valign: Gtk.Align.CENTER
        });
        
        try {
            const iconPath = GLib.build_filenamev([this.path, 'icons', 'folder-remote-connected-symbolic.svg']);
            const iconFile = Gio.File.new_for_path(iconPath);
            if (iconFile.query_exists(null)) {
                const customIcon = Gio.FileIcon.new(iconFile);
                extensionIcon.gicon = customIcon;
            } else {
                // Fallback to default icon
                extensionIcon.icon_name = 'folder-remote-symbolic';
            }
        } catch (e) {
            console.error('Error loading custom icon in preferences:', e);
            // Fallback to default icon
            extensionIcon.icon_name = 'folder-remote-symbolic';
        }
        
        extensionInfoRow.add_prefix(extensionIcon);
        aboutGroup.add(extensionInfoRow);
        
        // Dedication
        const dedicationRow = new Adw.ActionRow({
            title: _('This one is for Jupiter'),
            subtitle: _('✨🐱✨')
        });
        aboutGroup.add(dedicationRow);
        
        page.add(aboutGroup);
        
        // Technical details group
        const technicalGroup = new Adw.PreferencesGroup({
            title: _('Technical Information')
        });
        
        const versionRow = new Adw.ActionRow({
            title: _('Version'),
            subtitle: _('3.0')
        });
        technicalGroup.add(versionRow);
        
        const uuidRow = new Adw.ActionRow({
            title: _('Extension UUID'),
            subtitle: _('network-share-automount@gavindi.github.com')
        });
        technicalGroup.add(uuidRow);
        
        const githubRow = new Adw.ActionRow({
            title: _('Source code:'),
            subtitle: _('https://github.com/gavindi/network-automount')
        });
        technicalGroup.add(githubRow);

        page.add(technicalGroup);
    }
    
    _resetSettings(settings, window) {
        // Create a confirmation dialog
        const dialog = new Adw.MessageDialog({
            heading: _('Reset Settings?'),
            body: _('This will reset all extension settings to their default values. This action cannot be undone.'),
            modal: true,
            transient_for: window
        });
        
        dialog.add_response('cancel', _('Cancel'));
        dialog.add_response('reset', _('Reset'));
        dialog.set_response_appearance('reset', Adw.ResponseAppearance.DESTRUCTIVE);
        
        dialog.connect('response', (dialog, response) => {
            if (response === 'reset') {
                // Reset all settings to default
                settings.reset('check-interval');
                settings.reset('show-notifications');
                settings.reset('show-success-notifications');
                settings.reset('show-error-notifications');
                settings.reset('custom-mount-base');
                settings.reset('bookmark-settings');
                settings.reset('retry-attempts');
                settings.reset('retry-delay');
                settings.reset('symlink-mounts');
                
                // Close preferences window to force refresh
                window.close();
            }
            dialog.destroy();
        });
        
        dialog.present();
    }
}