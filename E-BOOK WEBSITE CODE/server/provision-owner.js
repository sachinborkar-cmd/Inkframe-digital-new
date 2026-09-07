// Explicit local provisioning; no role is granted during public registration.
require('dotenv').config({quiet:true});
const pool=require('./database');
(async()=>{try{
 const id=process.argv[2];if(!/^[1-9][0-9]*$/.test(id||''))throw Error('Usage: node server/provision-owner.js VERIFIED_USER_ID');
 await require('./schema').ensureSchema();
 const [r]=await pool.execute("update users set role='ADMIN',is_owner=1 where id=? and is_verified=1 and is_active=1",[id]);
 if(!r.affectedRows)throw Error('An existing verified, active user ID is required.');
 console.log('Owner role provisioned for the selected user.');
}finally{await pool.end();}})().catch(e=>{console.error(e.message);process.exitCode=1;});
