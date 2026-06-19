// content.js — PowerBookmark content script
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "GET_HTML") {
    (async () => {
      
      // 1. Hijack the native fetch API to bypass CORS via background.js
      const originalFetch = window.fetch;
      window.fetch = async function(resource, init) {
        let url = resource instanceof Request ? resource.url : resource;

        if (typeof url === 'string' && url.startsWith('http')) {
          return new Promise((resolve) => {
            chrome.runtime.sendMessage({ type: "PROXY_FETCH", url }, async (resp) => {
              if (!resp || resp.error) {
                try {
                  resolve(await originalFetch(resource, init));
                } catch(e) {
                  resolve(new Response(null, { status: 404 }));
                }
                return;
              }
              const blobResp = await originalFetch(resp.base64);
              const blob = await blobResp.blob();
              resolve(new Response(blob, { status: 200, headers: resp.headers }));
            });
          });
        }
        return originalFetch.apply(this, arguments);
      };

      try {
        // 2. Run SingleFile
        const result = await singlefile.getPageData({
          removeHiddenElements: true,
          removeUnusedStyles: true,
          removeUnusedFonts: true,
          removeImports: true,
          blockScripts: true,
          blockAudios: true,
          blockVideos: true,
          compressHTML: true,
          maxResourceSizeEnabled: true,
          maxResourceSize: 1048576
        });

        // 3. Encode to Base64 safely
        const bytes = new TextEncoder().encode(result.content);
        const blob = new Blob([bytes], { type: "text/html" });
        const reader = new FileReader();

        reader.onloadend = () => {
          const base64Data = reader.result.split(",")[1];
          // Send it back matching what background.js expects
          sendResponse({ b64: base64Data }); 
        };

        reader.readAsDataURL(blob);

      } catch (err) {
        console.error("PowerBookmark: SingleFile capture failed", err);
        sendResponse({ b64: null, error: err.message });
      } finally {
        // 4. Restore the webpage's normal fetch behavior
        window.fetch = originalFetch; 
      }

    })();
    return true; 
  }
});