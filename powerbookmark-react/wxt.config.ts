import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  extensionApi: 'chrome',
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'PowerBookmark',
    version: '1.8.0',
    description: 'Local-first bookmark manager with screenshot + HTML capture',
    permissions: [
      'tabs',
      'activeTab',
      'storage',
      'scripting',
      'bookmarks',
      'tabGroups', 
    ],
    host_permissions: [
      'http://127.0.0.1:8765/*',
      '<all_urls>'
    ],
    web_accessible_resources: [{
      resources: ['single-file-bundled.js', 'content.js'],
      matches: ['<all_urls>']
    }]
}
});