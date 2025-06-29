// Updated with ES modules
import Busboy from 'busboy';
import FormData from 'form-data';
import fetch from 'node-fetch';
import zlib from 'zlib';

// ES module config declaration (only one needed)
export const config = {
  api: {
    bodyParser: false,
    maxDuration: 800, // 13+ minutes with Pro + Fluid Compute
  },
};

export default async function handler(req, res) {
  console.log('🚀 API called - Method:', req.method);
  
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    console.log('✅ OPTIONS handled');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    console.log('❌ Wrong method:', req.method);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('📋 Setting up busboy...');
    
    const busboy = Busboy({ 
      headers: req.headers,
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
      }
    });
    
    let fileBuffer = null;
    let filename = 'document.pdf';
    let fileSize = 0;

    // Handle file upload
    busboy.on('file', (fieldname, file, info) => {
      console.log('📄 File detected:', info);
      filename = info.filename || 'document.pdf';
      
      const chunks = [];
      
      file.on('data', (chunk) => {
        chunks.push(chunk);
        fileSize += chunk.length;
      });
      
      file.on('end', () => {
        fileBuffer = Buffer.concat(chunks);
        console.log('✅ File collected:', {
          filename,
          size: fileBuffer.length
        });
      });
    });

    // Handle completion
    const uploadPromise = new Promise((resolve, reject) => {
      busboy.on('finish', () => {
        console.log('✅ Busboy finished');
        resolve();
      });
      
      busboy.on('error', (err) => {
        console.error('❌ Busboy error:', err);
        reject(err);
      });
      
      // Timeout after 30 seconds
      setTimeout(() => {
        reject(new Error('Upload timeout'));
      }, 30000);
    });

    // Pipe the request to busboy
    req.pipe(busboy);
    
    // Wait for upload to complete
    await uploadPromise;

    if (!fileBuffer) {
      console.log('❌ No file received');
      return res.status(400).json({ error: 'No file uploaded' });
    }

    console.log('📦 Creating FormData for webhook...');
    
    // Create form data to send to webhook
    const formData = new FormData();
    formData.append('file', fileBuffer, {
      filename: filename,
      contentType: 'application/pdf'
    });

    // Wait for full n8n response
    console.log('🌐 Sending to webhook and waiting for response...');

    const renderResponse = await fetch('https://9e9e-2601-43-4101-9a90-6129-93f-604a-d779.ngrok-free.app/webhook/7edcdf7b-bb9b-40db-9453-bf24cda276df', {
      method: 'POST',
      body: formData,
      headers: {
        ...formData.getHeaders(),
      },
    });

    console.log('📊 Webhook response:', renderResponse.status, renderResponse.statusText);

    if (!renderResponse.ok) {
      const errorText = await renderResponse.text();
      console.error('❌ Webhook failed:', renderResponse.status, errorText);
      return res.status(500).json({ 
        error: 'Analysis failed', 
        details: errorText,
        status: renderResponse.status 
      });
    }

    // Get the complete response data
    const responseText = await renderResponse.text();
    console.log('📥 Webhook response received, length:', responseText.length);

    let responseData;
    try {
      responseData = JSON.parse(responseText);
      console.log('✅ JSON parsed successfully');
    } catch (parseError) {
      console.error('❌ JSON parse failed:', parseError.message);
      return res.status(500).json({ 
        error: 'Invalid response format',
        rawResponse: responseText.substring(0, 1000)
      });
    }

    console.log('✅ Success! Returning analysis results to frontend');
    
    // Handle both array and object responses from n8n
    let factCheckData;
    if (Array.isArray(responseData)) {
      if (responseData.length === 0) {
        return res.status(500).json({ error: 'Empty array received from webhook' });
      }
      factCheckData = responseData[0];
    } else if (responseData && typeof responseData === 'object') {
      factCheckData = responseData;
    } else {
      console.log('❌ Invalid response data structure:', responseData);
      return res.status(500).json({ error: 'No valid data received from webhook' });
    }
    
    console.log('📊 Returning data for document:', factCheckData?.summary?.documentTitle);
    
    // Compress the response to handle large payloads
    const jsonString = JSON.stringify(factCheckData);
    console.log('📏 Response size before compression:', jsonString.length, 'bytes');
    
    const compressedData = zlib.gzipSync(jsonString);
    console.log('📏 Response size after compression:', compressedData.length, 'bytes');
    
    res.setHeader('Content-Encoding', 'gzip');
    res.setHeader('Content-Type', 'application/json');
    return res.send(compressedData);

  } catch (error) {
    console.error('💥 Caught error:', error.message);
    console.error('💥 Error stack:', error.stack);
    return res.status(500).json({ 
      error: 'Internal server error',
      message: error.message
    });
  }
}
