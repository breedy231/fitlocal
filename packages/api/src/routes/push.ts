import { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { db } from '../db.js';

interface PushSubscriptionBody {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

interface DeleteSubscriptionBody {
  endpoint: string;
}

interface PushSubscriptionRow {
  id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: string;
}

export async function pushRoutes(app: FastifyInstance) {
  // POST /push-subscriptions — upsert by endpoint
  app.post<{ Body: PushSubscriptionBody }>('/push-subscriptions', {
    schema: {
      body: {
        type: 'object',
        required: ['endpoint', 'keys'],
        additionalProperties: false,
        properties: {
          endpoint: { type: 'string' },
          keys: {
            type: 'object',
            required: ['p256dh', 'auth'],
            additionalProperties: false,
            properties: {
              p256dh: { type: 'string' },
              auth: { type: 'string' },
            },
          },
        },
      },
    },
  }, async (req, reply) => {
    const { endpoint, keys } = req.body;
    db.run(sql`
      INSERT INTO push_subscriptions (endpoint, p256dh, auth)
      VALUES (${endpoint}, ${keys.p256dh}, ${keys.auth})
      ON CONFLICT(endpoint) DO UPDATE SET
        p256dh = excluded.p256dh,
        auth = excluded.auth
    `);
    return reply.code(201).send({ ok: true });
  });

  // GET /push-subscriptions — list all (used by briefing sender)
  app.get('/push-subscriptions', async (_req, reply) => {
    const rows = db.all<PushSubscriptionRow>(
      sql`SELECT id, endpoint, p256dh, auth, created_at FROM push_subscriptions ORDER BY created_at DESC`
    );
    return reply.send(rows.map(r => ({
      id: r.id,
      endpoint: r.endpoint,
      keys: { p256dh: r.p256dh, auth: r.auth },
      createdAt: r.created_at,
    })));
  });

  // DELETE /push-subscriptions — remove by endpoint (client opt-out)
  app.delete<{ Body: DeleteSubscriptionBody }>('/push-subscriptions', {
    schema: {
      body: {
        type: 'object',
        required: ['endpoint'],
        additionalProperties: false,
        properties: {
          endpoint: { type: 'string' },
        },
      },
    },
  }, async (req, reply) => {
    const { endpoint } = req.body;
    db.run(sql`DELETE FROM push_subscriptions WHERE endpoint = ${endpoint}`);
    return reply.code(204).send();
  });

  // GET /push/vapid-public-key — expose public key to client for subscribe
  app.get('/push/vapid-public-key', async (_req, reply) => {
    return reply.send({
      publicKey: process.env.FITLOCAL_VAPID_PUBLIC_KEY ?? null,
    });
  });
}
