const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const pool=require('./database');
const s3Storage=require('./storage/s3');
const cache=new Map();
async function fingerprint(file){
  const stat=await fs.stat(file),stamp=stat.mtimeMs+':'+stat.ctimeMs+':'+stat.size;
  const old=cache.get(file);if(old?.stamp===stamp)return old.hash;
  const hash=crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
  if(cache.size>1000)cache.clear();cache.set(file,{stamp,hash});return hash;
}
async function safeSample(sample){
  if(!/^\/assets\/uploads\/[a-zA-Z0-9-]+\.pdf$/.test(sample||''))return false;
  try{
    const hash=await fingerprint(path.resolve(__dirname,'../client','.'+sample));
    const [books]=await pool.query('select distinct pdf_path from ebooks where pdf_path is not null');
    for(const book of books){
      if(s3Storage.isS3Path(book.pdf_path)){
        if(s3Storage.isS3Configured()){
          try{
            const key=s3Storage.extractS3Key(book.pdf_path);
            const buf=await s3Storage.getEbookBuffer(key);
            const paid=crypto.createHash('sha256').update(buf).digest('hex');
            if(paid===hash)return false;
          }catch(e){continue;}
        }
        continue;
      }
      const privatePath=require('./book-files').paidFile(book.pdf_path);
      let paid;try{paid=await fingerprint(privatePath);}catch(e){if(e.code==='ENOENT')continue;throw e;}
      if(paid===hash)return false;
    }
    return true;
  }catch{return false;}
}
module.exports={safeSample};
