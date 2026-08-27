// Local-only preview with synthetic data. Run: node tests/preview-project-statements.cjs
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const fixture=require('./project-statement-fixture.cjs');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const section=index.slice(index.indexOf('<section id="reportsView"'),index.indexOf('</section>',index.indexOf('<section id="reportsView"'))+10).replace('class="view"','class="view active"');
const core=fs.readFileSync(path.join(root,'app-mobile.js'),'utf8').split('class Store')[0];
const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Statement test preview</title><link rel="stylesheet" href="/mobile.css"><link rel="stylesheet" href="/reports-mobile.css"><style>body{padding:20px}main{max-width:430px;margin:auto}#reportsView{display:block}</style></head><body><main>${section}</main><script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.2/html2pdf.bundle.min.js"></script><script src="/fixture.js"></script><script src="/reports-mobile.js"></script></body></html>`;
const script=core+`\nObject.assign(state,${JSON.stringify(fixture)});\nfunction toast(message){console.log(message)}\nasync function working(message,button,fn){button.disabled=true;try{return await fn()}finally{button.disabled=false}}`;
const files={'/mobile.css':'text/css','/reports-mobile.css':'text/css','/reports-mobile.js':'text/javascript','/assets/mughal-logo.png':'image/png'};
http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost').pathname;if(url==='/'){res.setHeader('Content-Type','text/html');res.end(html);}else if(url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(script);}else if(files[url]){res.setHeader('Content-Type',files[url]);res.end(fs.readFileSync(path.join(root,url.slice(1))));}else{res.writeHead(404);res.end();}}).listen(8765,'0.0.0.0',()=>console.log('Synthetic statement preview: http://localhost:8765'));
