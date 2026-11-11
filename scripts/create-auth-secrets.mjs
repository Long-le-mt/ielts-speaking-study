import { createHash, randomBytes } from 'node:crypto';

const username = process.argv[2] ?? 'learner';
if (!/^[a-zA-Z0-9_.@-]{1,128}$/.test(username)) {
  process.stderr.write('Use 1–128 letters, numbers, or ._@- for the username.\n');
  process.exit(1);
}

const password = randomBytes(24).toString('hex');
const hash = createHash('sha256').update(password).digest('hex');
const sessionKey = randomBytes(32).toString('hex');

console.log(`Login username: ${username}`);
console.log(`Login password: ${password}`);
console.log('Save the password privately. Configure these values as Worker secrets:');
console.log(`AUTH_USERNAME=${username}`);
console.log(`AUTH_PASSWORD_SHA256=${hash}`);
console.log(`SESSION_KEY=${sessionKey}`);
