// image-worker.js

const MAX_WIDTH = 1200; 

// --- 0. IMAGE PROCESSOR (Worker Thread) ---
const imageProcessor = {
    // Implementaciones de filtros
    applyNoir: (d) => { const len = d.length; for (let i = 0; i < len; i += 4) { const avg = (d[i]*0.3 + d[i+1]*0.59 + d[i+2]*0.11) | 0; d[i]=avg; d[i+1]=avg; d[i+2]=avg; } },
    applyVampire: (d) => { const len = d.length; for (let i = 0; i < len; i += 4) { d[i] = (d[i] * 1.8) | 0; d[i+1] = (d[i+1] * 0.4) | 0; d[i+2] = (d[i+2] * 0.4) | 0; } },
    applyGlitch: (d) => { const len = d.length; for (let i = 0; i < len; i += 4) { if (Math.random() > 0.98) { d[i] = 255; d[i+1] = 0; d[i+2] = 255; } } },

    process: async (file, title, filter) => {
        try {
            const imgBitmap = await createImageBitmap(file);
            const canvas = new OffscreenCanvas(1, 1); 
            const ctx = canvas.getContext('2d');
            
            const scale = imgBitmap.width > MAX_WIDTH ? MAX_WIDTH / imgBitmap.width : 1;
            const w = Math.floor(imgBitmap.width * scale);
            const h = Math.floor(imgBitmap.height * scale);
            
            canvas.width = w;
            canvas.height = h;
            ctx.drawImage(imgBitmap, 0, 0, w, h);
            
            let imageData = ctx.getImageData(0, 0, w, h);
            
            if (filter === 'noir') imageProcessor.applyNoir(imageData.data);
            if (filter === 'vampire') imageProcessor.applyVampire(imageData.data);
            if (filter === 'glitch') imageProcessor.applyGlitch(imageData.data);

            ctx.putImageData(imageData, 0, 0);
            
            const processedBlob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });

            const record = { 
                title: title, 
                created: Date.now(), 
                image: processedBlob,
                isEncrypted: false,
                workerStatus: 'ok' 
            };
            
            return record;

        } catch (error) {
            throw error;
        }
    }
};

// Escuchar los datos del hilo principal
self.onmessage = async (e) => {
    const { file, title, filter } = e.data;
    
    try {
        const record = await imageProcessor.process(file, title, filter);
        
        self.postMessage(record, [record.image]); 
    } catch (error) {
        self.postMessage({ error: error.message, workerStatus: 'fail' });
    }
};
