import { createServer } from 'http';
import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { testConnection } from './config/database';
import { initRealtime } from './services/realtime.service';
import { simulationEngine } from './services/simulation/SimulationEngine';
import { bnrSensor } from './services/sensors/BNRSensor';

const PORT = parseInt(process.env.PORT || '4000');

async function bootstrap() {
  await testConnection();

  const httpServer = createServer(app);
  const io = initRealtime(httpServer);

  // Make io available to controllers if needed
  app.set('io', io);

  // Injecte Socket.io dans le moteur de simulation AVANT tout démarrage.
  // Le moteur est un singleton — l'injection ici évite une dépendance circulaire
  // entre SimulationEngine et server.ts.
  simulationEngine.init(io);

  // Lance la génération automatique de lectures BNR toutes les 5 minutes
  // en production (utile pour monitorer en temps réel sans déclencher manuellement).
  if (process.env.AUTO_BNR === 'true') {
    const siteId = process.env.DEFAULT_SITE_ID;
    if (siteId) {
      setInterval(() => {
        bnrSensor.generateReadings(siteId, 'STABLE').catch(() => {});
      }, 5 * 60 * 1000);
    }
  }

  const HOST = '0.0.0.0'; // écoute sur toutes les interfaces pour accès LAN
  httpServer.listen(PORT, HOST, () => {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    let lanIp = 'localhost';
    for (const ifaces of Object.values(nets) as any[]) {
      for (const iface of ifaces) {
        if (iface.family === 'IPv4' && !iface.internal) {
          lanIp = iface.address;
          break;
        }
      }
    }
    console.log(`\n🚀 FMS Mining API running on port ${PORT}`);
    console.log(`📡 WebSocket server ready`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV}`);
    console.log(`\n  Local : http://localhost:${PORT}/api/v1`);
    console.log(`  LAN   : http://${lanIp}:${PORT}/api/v1`);
    console.log(`\n  Login : admin / Admin@Mine2024`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason);
  // do not exit — let the process continue serving other requests
});
