/**
 * Chrome/Firefox Bookmark HTML Parser
 * Converts the nested <DL><DT><H3> structure into a clean JSON tree.
 */

// Helper to generate quick unique IDs for our staging UI
const generateId = () => 'import_' + Math.random().toString(36).substr(2, 9);

export async function parseBookmarksHtml(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        
        reader.onload = (e) => {
            try {
                const text = e.target.result;
                const parser = new DOMParser();
                const doc = parser.parseFromString(text, 'text/html');
                
                // Chrome puts the main tree inside the first <DL>
                const rootDl = doc.querySelector('dl');
                if (!rootDl) throw new Error("Could not find bookmark tree in file.");

                const parsedTree = parseDlNode(rootDl);
                resolve(parsedTree);
            } catch (err) {
                reject(err);
            }
        };
        
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsText(file);
    });
}

// Recursively walk the <DL> (Definition List) tags
function parseDlNode(dlElement) {
    const items = [];
    
    // <DT> tags hold the actual items (either an <A> link or an <H3> folder)
    const dtElements = Array.from(dlElement.children).filter(el => el.tagName === 'DT');

    for (const dt of dtElements) {
        // Is it a Folder? (Has an H3 and usually a nested DL right after it)
        const h3 = dt.querySelector('h3');
        if (h3) {
            // Find the <DL> that belongs to this folder
            // It's usually a direct child of the <DT> or a sibling next to it
            let childDl = dt.querySelector('dl');
            if (!childDl && dt.nextElementSibling?.tagName === 'DL') {
                childDl = dt.nextElementSibling;
            }

            items.push({
                id: generateId(),
                type: 'folder',
                name: h3.textContent.trim(),
                addDate: h3.getAttribute('add_date'),
                selected: true, // For our staging UI checkboxes
                children: childDl ? parseDlNode(childDl) : []
            });
            continue;
        }

        // Is it a Bookmark? (Has an A tag)
        const a = dt.querySelector('a');
        if (a) {
            items.push({
                id: generateId(),
                type: 'bookmark',
                title: a.textContent.trim() || a.getAttribute('href'),
                url: a.getAttribute('href'),
                addDate: a.getAttribute('add_date'),
                icon: a.getAttribute('icon'), // Base64 favicon if it exists
                selected: true // For our staging UI checkboxes
            });
        }
    }

    return items;
}
