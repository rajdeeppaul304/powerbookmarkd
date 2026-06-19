const KEY = 'pb_last_folder';

export async function loadLastFolder() {
    const stored = await chrome.storage.local.get(KEY);
    return stored[KEY] || null;
}

export async function saveLastFolder(vault, folderId, folderName) {
    await chrome.storage.local.set({ [KEY]: { vault, folder_id: folderId, folder_name: folderName } });
}