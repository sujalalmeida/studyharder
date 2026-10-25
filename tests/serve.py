"""Local QA with a synthetic camera. Run: python3 tests/serve.py"""
from http.server import SimpleHTTPRequestHandler, HTTPServer
from pathlib import Path
import os
os.chdir(Path(__file__).resolve().parents[1])
fixture = '''<script>
const testCamera = document.createElement('canvas');testCamera.width=1280;testCamera.height=720;
const testCtx=testCamera.getContext('2d');let testFrame=0;
setInterval(()=>{testCtx.fillStyle=`hsl(${testFrame++ % 360},45%,40%)`;testCtx.fillRect(0,0,1280,720);testCtx.fillStyle='white';testCtx.font='70px sans-serif';testCtx.fillText('Synthetic study session '+testFrame,100,360);},80);
Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>testCamera.captureStream(12)});
</script>'''
class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == '/':
            html=Path('dist/index.html').read_text().replace('href="style.css"','href="/dist/style.css"').replace('<script src="app.js"',fixture+'<script src="/dist/app.js"')
            self.send_response(200);self.send_header('Content-Type','text/html');self.end_headers();self.wfile.write(html.encode())
        else: super().do_GET()
HTTPServer(('127.0.0.1',4174),Handler).serve_forever()
