require('dotenv').config({quiet:true});
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const pool=require('../../../server/database');
const Store=require('express-mysql-session')(require('express-session'));
const options={createDatabaseTable:false,clearExpired:false,schema:{tableName:'sessions'}};
const first=new Store(options,pool),second=new Store(options,pool);
const id='hardening-'+crypto.randomUUID();
(async()=>{try{
  await Promise.all([first.onReady(),second.onReady()]);
  const data={cookie:{expires:new Date(Date.now()+60000).toISOString()},userId:1,sessionVersion:7};
  await first.set(id,data);assert.deepEqual(await second.get(id),data);
  await second.touch(id,{cookie:{expires:new Date(Date.now()+120000)}});
  assert.equal((await first.get(id)).sessionVersion,7);
  const values=await Promise.all(Array.from({length:12},(_,i)=>pool.execute('select ? as value',[i])));
  values.forEach((result,i)=>assert.equal(result[0][0].value,i));
  await second.destroy(id);assert.equal(await first.get(id),null);
  console.log('PASS: MySQL-backed sessions survive a store replacement; touch, destroy and pooled bound queries work.');
}finally{await first.destroy(id).catch(()=>{});await first.close();await second.close();await pool.end();}
})().catch(()=>{console.error('Session-store integration failed. Check database availability and schema.');process.exitCode=1;});
