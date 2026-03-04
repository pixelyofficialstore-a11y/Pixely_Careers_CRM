import { db, pool } from "./db";
import { users, orders, orderServices, notifications, paymentVerifications } from "@shared/schema";

export async function seedDatabase() {
  const existingUsers = await db.select().from(users).limit(1);
  
  if (existingUsers.length > 0) {
    console.log("Database already has data, skipping seed.");
    return;
  }
  
  console.log("Seeding database with initial data...");
  
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    await client.query(`
      INSERT INTO users (id, username, password, role, name, title, avatar, is_active, created_at) VALUES
      (1, 'Muhammad Hamza', '92c7b8dfd7bc68730e01793811d40bf253504f3a9194ebe230de8943f44202813cf4c06ca5c9ef1eaa98d864dec9088b704a621f572db95932093547b42d7f4b.ce73c1ca8158d40ce2799358033e330d', 'designer', 'Muhammad Hamza', 'Junior Graphic Designer', NULL, true, '2026-01-26T16:40:34.582Z'),
      (2, 'Husnain Atta', '93bf8f11824d290764e22035b6075e0a51c6acfa1673bddf11935823a66ee0c066085b3ea15bc9e0d93d923492793162e6263ac695d7b31046110fb701b72899.c2baa28b7ccf0314bf7a1667fd4d1a93', 'support', 'Support Agent', 'Customer Success', NULL, true, '2026-01-26T16:40:34.691Z'),
      (3, 'Muhammad Anas', '26f09d3f9258d872d5d79b7b50cc0d82301a1d7ab201149d78624b9adf9550691f31a27890f42aac10d3f6957e680cb9be1184dd954791091d99f05e3122f619.a268de57b0ecf24e64aab6f0bb6a8a0d', 'designer', 'Muhammad Anas', 'Senior Graphic Designer', '/api/avatars/avatar-3-1770038999542.jpeg', true, '2026-01-26T16:40:34.799Z'),
      (4, 'Soban Masood', 'fd09ed74854c0d214a41262b912e8c06121ab6ef20c9da9439c183a8d5a2abc43dda4d28d8c8d5559a71477938b075f19ffd1666330fca93011392927e9feac1.99750c95fe169d4ac48e59746218607a', 'admin', 'Soban Masood', 'Agency Owner', NULL, true, '2026-01-31T18:10:32.800Z'),
      (5, 'Safwan Masood', 'f9d6bc4cb41c1e4e0a490091d125af3d8b3016cdf8407efcef21647d43437454201a31291149e5b8e687fcc5c4de061bbcde7620ec0fd6aa7c043ad42517d247.e7c1e3529ebd747855d645063c83fc53', 'designer', 'Safwan Masood', NULL, NULL, true, '2026-02-01T19:26:44.553Z')
    `);
    
    await client.query(`SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1))`);
    
    await client.query('COMMIT');
    console.log("Database seeded with initial data successfully!");
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("Error seeding database:", error);
  } finally {
    client.release();
  }
}
