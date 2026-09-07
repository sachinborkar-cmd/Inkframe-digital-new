require('dotenv').config();
const { verifyEmailTransport } = require('../server/email');

verifyEmailTransport()
  .then(() => console.log('SMTP authentication and connection succeeded.'))
  .catch((error) => {
    console.error(`SMTP verification failed: ${error.message}`);
    process.exit(1);
  });
