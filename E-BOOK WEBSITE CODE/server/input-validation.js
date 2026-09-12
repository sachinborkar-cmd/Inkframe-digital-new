const validSlug = value => typeof value === 'string' && /^[a-z0-9-]{1,160}$/.test(value);
function idParam(req, res, next, value) {
  if (!/^[1-9][0-9]{0,15}$/.test(value) || !Number.isSafeInteger(Number(value))) {
    return res.status(400).json({error:'Invalid record ID.'});
  }
  next();
}
function emailParam(req, res, next, value) {
  if (!require('./auth').isValidEmail(value)) return res.status(400).json({error:'Invalid email address.'});
  next();
}
module.exports = { validSlug, idParam, emailParam };
