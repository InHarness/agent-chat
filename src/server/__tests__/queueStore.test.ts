import { describe, expect, it } from 'vitest';
import { QueueStore } from '../queue-store.js';

const TS = '2026-04-28T00:00:00.000Z';

describe('QueueStore', () => {
  it('enqueues and snapshots in FIFO order, isolated per thread', () => {
    const q = new QueueStore();
    const a = q.enqueue('t1', 'first', TS);
    const b = q.enqueue('t1', 'second', TS);
    q.enqueue('t2', 'other', TS);

    expect(q.size('t1')).toBe(2);
    expect(q.snapshot('t1').map(m => m.text)).toEqual(['first', 'second']);
    expect(q.snapshot('t2').map(m => m.text)).toEqual(['other']);
    expect(a.id).not.toBe(b.id);
  });

  it('snapshot is a copy (mutating it does not affect the store)', () => {
    const q = new QueueStore();
    q.enqueue('t1', 'x', TS);
    const snap = q.snapshot('t1');
    snap.pop();
    expect(q.size('t1')).toBe(1);
  });

  it('enforces the limit via isFull', () => {
    const q = new QueueStore(2);
    q.enqueue('t1', 'a', TS);
    expect(q.isFull('t1')).toBe(false);
    q.enqueue('t1', 'b', TS);
    expect(q.isFull('t1')).toBe(true);
  });

  it('removes a single message by id and returns it', () => {
    const q = new QueueStore();
    const a = q.enqueue('t1', 'a', TS);
    const b = q.enqueue('t1', 'b', TS);

    expect(q.remove('t1', a.id)).toEqual(a);
    expect(q.snapshot('t1')).toEqual([b]);
    expect(q.remove('t1', 'nope')).toBeNull();
  });

  it('popAll drains and returns FIFO, leaving the queue empty', () => {
    const q = new QueueStore();
    q.enqueue('t1', 'a', TS);
    q.enqueue('t1', 'b', TS);

    expect(q.popAll('t1').map(m => m.text)).toEqual(['a', 'b']);
    expect(q.size('t1')).toBe(0);
    expect(q.popAll('t1')).toEqual([]);
  });

  it('clear is an alias for popAll', () => {
    const q = new QueueStore();
    q.enqueue('t1', 'a', TS);
    expect(q.clear('t1').map(m => m.text)).toEqual(['a']);
    expect(q.size('t1')).toBe(0);
  });
});
