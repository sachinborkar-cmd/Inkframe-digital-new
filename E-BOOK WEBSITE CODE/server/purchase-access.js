function testEnabled(){return process.env.NODE_ENV!=='production'&&process.env.TEST_PAYMENTS_ENABLED==='true';}
function paidCondition(alias='o'){
  return `${alias}.status='paid' and ((${alias}.payment_method<>'test' and ${alias}.verified_at is not null)${testEnabled()?` or ${alias}.payment_method='test'`:''})`;
}
module.exports={testEnabled,paidCondition};
