const pool = require('./database');
async function sessionUser(request) {
  if(!request.session?.userId)return null;
  const [[user]]=await pool.execute('select id,email,is_verified,is_active,role,is_owner,session_version from users where id=?',[request.session.userId]);
  if(!user||!user.is_verified||!user.is_active||user.session_version!==Number(request.session.sessionVersion||0))return null;
  return user;
}
async function requireAuth(request,response,next){
  try{
    const user=await sessionUser(request);
    if(!user)return response.status(401).json({error:'Authentication required. Please sign in again.'});
    request.user=user;response.setHeader('Cache-Control','no-store');next();
  }catch(error){next(error);}
}
async function adminAccess(userId){
  if(!userId)return {isOwner:false,isAdmin:false};
  const [[u]]=await pool.execute('select role,is_owner,is_verified,is_active from users where id=?',[userId]);
  const isAdmin=Boolean(u&&u.is_verified&&u.is_active&&u.role==='ADMIN');
  return {isOwner:isAdmin&&Boolean(u.is_owner),isAdmin};
}
function requireAdmin(request,response,next){
  return requireAuth(request,response, error=>{
    if(error)return next(error);
    if(request.user.role!=='ADMIN')return response.status(403).json({error:'Administrator access required.'});
    request.isOwner=Boolean(request.user.is_owner);next();
  });
}
module.exports={requireAuth,requireAdmin,adminAccess,sessionUser};
