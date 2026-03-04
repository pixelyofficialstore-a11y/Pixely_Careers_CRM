import { readFileSync } from 'fs';
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({ 
  connectionString: process.env.SUPABASE_DATABASE_URL, 
  ssl: { rejectUnauthorized: false } 
});

const orders = JSON.parse(readFileSync('/tmp/orders_recovered.json', 'utf8'));

// Extract all unique users
const usersMap = new Map();
for (const o of orders) {
  if (o.assignee) usersMap.set(o.assignee.id, o.assignee);
}

console.log('Users found in orders:');
for (const [id, u] of usersMap) {
  console.log(`  id=${id} name="${u.name}" role="${u.role}"`);
}

// Check assignedToId and createdById ranges
const assignedToIds = [...new Set(orders.map(o => o.assignedToId).filter(Boolean))];
const createdByIds = [...new Set(orders.map(o => o.createdById).filter(Boolean))];
console.log('assignedToId values:', assignedToIds.sort((a,b)=>a-b));
console.log('createdById values:', createdByIds.sort((a,b)=>a-b));

pool.end();
