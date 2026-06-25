const net = require('node:net');
const ports = ['FRONTEND_PORT', 'BACKEND_PORT', 'MEDIA_PORT', 'ADMIN_PORT', 'WEBSOCKET_PORT']
  .map((key) => Number(process.env[key]))
  .filter(Boolean);

function check(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve({ port, available: false }));
    server.once('listening', () => server.close(() => resolve({ port, available: true })));
    server.listen(port, '127.0.0.1');
  });
}

Promise.all(ports.map(check)).then((results) => {
  const blocked = results.filter((item) => !item.available);
  if (blocked.length) {
    console.error('Port conflict:', blocked.map((item) => item.port).join(', '));
    process.exit(1);
  }
  console.log('All configured ports are available.');
});
