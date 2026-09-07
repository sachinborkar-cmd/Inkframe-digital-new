const crypto=require('node:crypto');
const pool=require('./database');
async function take(key,limit,seconds){
  const bucket=crypto.createHash('sha256').update(key).digest('hex');
  const c=await pool.getConnection();
  try{
    await c.beginTransaction();
    await c.execute(`insert into auth_rate_limits(bucket,hits,expires_at) values (?,1,date_add(now(),interval ? second))
      on duplicate key update hits=if(expires_at<=now(),1,hits+1),expires_at=if(expires_at<=now(),values(expires_at),expires_at)`,[bucket,seconds]);
    const [[r]]=await c.execute('select hits from auth_rate_limits where bucket=?',[bucket]);
    await c.commit();return r.hits<=limit;
  }catch(e){await c.rollback();throw e;}finally{c.release();}
}
function limit(scope,count=30,seconds=900){return async(req,res,next)=>{try{
  if(!await take(scope+':ip:'+req.ip,count,seconds)){res.setHeader('Retry-After',String(seconds));return res.status(429).json({error:'Too many requests. Please try again later.'});}
  next();
}catch(e){next(e);}};}
module.exports={take,limit};
