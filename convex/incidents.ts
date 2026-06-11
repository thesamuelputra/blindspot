import { v } from 'convex/values';
import { mutation, query } from './_generated/server';

// Incident workspace (ARCHITECTURE §7.8, BRIEF §8.11). Auth-gated like the
// rest of the console: queries return empty/null for unauthenticated callers,
// mutations throw. Attached signals and the timeline live in child tables
// (incidentSignals / incidentEvents), never as arrays on the incident doc.

const incidentStatus = v.union(v.literal('open'), v.literal('monitoring'), v.literal('closed'));

export const list = query({
  args: {},
  handler: async (ctx) => {
    if ((await ctx.auth.getUserIdentity()) === null) return [];
    const incidents = await ctx.db.query('incidents').order('desc').collect();
    return await Promise.all(
      incidents.map(async (incident) => {
        const links = await ctx.db
          .query('incidentSignals')
          .withIndex('by_incident', (q) => q.eq('incidentId', incident._id))
          .collect();
        return { ...incident, signalCount: links.length };
      }),
    );
  },
});

export const get = query({
  args: { id: v.id('incidents') },
  handler: async (ctx, { id }) => {
    if ((await ctx.auth.getUserIdentity()) === null) return null;
    const incident = await ctx.db.get(id);
    if (!incident) return null;
    const links = await ctx.db
      .query('incidentSignals')
      .withIndex('by_incident', (q) => q.eq('incidentId', id))
      .collect();
    const signals = [];
    for (const link of links) {
      const signal = await ctx.db.get(link.signalId);
      if (signal) signals.push({ ...signal, addedAt: link.addedAt });
    }
    const events = await ctx.db
      .query('incidentEvents')
      .withIndex('by_incident_at', (q) => q.eq('incidentId', id))
      .order('asc')
      .collect();
    return { incident, signals, events };
  },
});

export const create = mutation({
  args: { title: v.string() },
  handler: async (ctx, { title }) => {
    if ((await ctx.auth.getUserIdentity()) === null) throw new Error('Not signed in');
    const trimmed = title.trim();
    if (!trimmed) throw new Error('Incident title is required');
    const id = await ctx.db.insert('incidents', {
      title: trimmed,
      status: 'open',
      createdAt: Date.now(),
    });
    await ctx.db.insert('incidentEvents', {
      incidentId: id,
      at: Date.now(),
      text: 'incident opened',
      auto: true,
    });
    return id;
  },
});

export const setStatus = mutation({
  args: { id: v.id('incidents'), status: incidentStatus },
  handler: async (ctx, { id, status }) => {
    if ((await ctx.auth.getUserIdentity()) === null) throw new Error('Not signed in');
    const incident = await ctx.db.get(id);
    if (!incident) throw new Error('Incident not found');
    if (incident.status === status) return;
    await ctx.db.patch(id, { status });
    await ctx.db.insert('incidentEvents', {
      incidentId: id,
      at: Date.now(),
      text: `status set to ${status}`,
      auto: true,
    });
  },
});

export const addSignal = mutation({
  args: { incidentId: v.id('incidents'), signalId: v.id('signals') },
  handler: async (ctx, { incidentId, signalId }) => {
    if ((await ctx.auth.getUserIdentity()) === null) throw new Error('Not signed in');
    const incident = await ctx.db.get(incidentId);
    if (!incident) throw new Error('Incident not found');
    const signal = await ctx.db.get(signalId);
    if (!signal) throw new Error('Signal not found');
    // attaching twice is a no-op, so the timeline never gets duplicate entries
    const links = await ctx.db
      .query('incidentSignals')
      .withIndex('by_incident', (q) => q.eq('incidentId', incidentId))
      .collect();
    if (links.some((l) => l.signalId === signalId)) return;
    await ctx.db.insert('incidentSignals', { incidentId, signalId, addedAt: Date.now() });
    await ctx.db.insert('incidentEvents', {
      incidentId,
      at: Date.now(),
      text: `signal attached: ${signal.title}`,
      auto: true,
    });
  },
});

export const addNote = mutation({
  args: { incidentId: v.id('incidents'), text: v.string() },
  handler: async (ctx, { incidentId, text }) => {
    if ((await ctx.auth.getUserIdentity()) === null) throw new Error('Not signed in');
    const incident = await ctx.db.get(incidentId);
    if (!incident) throw new Error('Incident not found');
    const trimmed = text.trim();
    if (!trimmed) throw new Error('Note text is required');
    await ctx.db.insert('incidentEvents', {
      incidentId,
      at: Date.now(),
      text: trimmed,
      auto: false,
    });
  },
});

export const remove = mutation({
  args: { id: v.id('incidents') },
  handler: async (ctx, { id }) => {
    if ((await ctx.auth.getUserIdentity()) === null) throw new Error('Not signed in');
    const incident = await ctx.db.get(id);
    if (!incident) return; // already gone: removal is idempotent
    const links = await ctx.db
      .query('incidentSignals')
      .withIndex('by_incident', (q) => q.eq('incidentId', id))
      .collect();
    for (const link of links) await ctx.db.delete(link._id);
    const events = await ctx.db
      .query('incidentEvents')
      .withIndex('by_incident_at', (q) => q.eq('incidentId', id))
      .collect();
    for (const event of events) await ctx.db.delete(event._id);
    await ctx.db.delete(id);
  },
});
