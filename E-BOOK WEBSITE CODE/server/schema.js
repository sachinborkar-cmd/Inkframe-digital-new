const pool = require('./database');

async function columnExists(table, column) {
  const [rows] = await pool.execute(
    'select 1 from information_schema.columns where table_schema = ? and table_name = ? and column_name = ? limit 1',
    [process.env.DB_NAME, table, column]
  );
  return rows.length > 0;
}

async function ensureSchema() {
  const orderColumns = {
    order_number: "bigint unsigned null unique",
    payment_method: "varchar(20) null",
    checkout_key: "varchar(80) null unique",
    delivery_email: "varchar(254) null",
    customer_details: "json null",
    email_sent_at: "datetime null",
    email_attempt_at: "datetime null",
    email_attempt_count: "int unsigned not null default 0",
    email_last_error: "varchar(60) null",
    checkout_group: "varchar(80) null"
  };
  for (const [column, definition] of Object.entries(orderColumns)) {
    if (!await columnExists('orders', column)) await pool.query(`alter table orders add column ${column} ${definition}`);
  }
  await pool.query(`create table if not exists order_sequence (
    id tinyint unsigned not null primary key, next_number bigint unsigned not null
  ) engine=InnoDB`);
  await pool.query('insert ignore into order_sequence(id,next_number) values (1,1)');
  const connection = await pool.getConnection();
  try { await require('./order-numbering').backfillOrderNumbers(connection); }
  finally { connection.release(); }
  if (!await columnExists('ebooks', 'status')) await pool.query("alter table ebooks add column status enum('draft','published','archived') not null default 'published'");
  if (!await columnExists('ebooks', 'description')) await pool.query('alter table ebooks add column description text null');
  if (!await columnExists('ebooks', 'cover_path')) await pool.query('alter table ebooks add column cover_path varchar(500) null');
  if (!await columnExists('ebooks', 'category_id')) await pool.query('alter table ebooks add column category_id bigint unsigned null');
  if (!await columnExists('ebooks', 'sample_path')) await pool.query('alter table ebooks add column sample_path varchar(500) null');
  for (const column of ['preview_pages', 'testimonials']) {
    if (!await columnExists('ebooks', column)) await pool.query(`alter table ebooks add column ${column} json null`);
  }
  if (!await columnExists('orders', 'download_count')) await pool.query('alter table orders add column download_count int unsigned not null default 0');
  await pool.query(`create table if not exists admin_members (email varchar(254) not null primary key, created_at timestamp not null default current_timestamp) engine=InnoDB`);
  await require('./security-schema')();
  await pool.query(`create table if not exists categories (
    id bigint unsigned not null auto_increment, name varchar(120) not null, slug varchar(140) not null,
    description text null, status enum('draft','active') not null default 'active', sort_order int not null default 0,
    primary key(id), unique key uq_categories_slug(slug)
  ) engine=InnoDB`);
  if (!await columnExists('categories', 'banner_path')) await pool.query('alter table categories add column banner_path varchar(500) null');
  await pool.query(`create table if not exists carts (
    user_id bigint unsigned not null, ebook_id bigint unsigned not null, created_at timestamp not null default current_timestamp,
    primary key(user_id, ebook_id), constraint fk_cart_user foreign key(user_id) references users(id) on delete cascade,
    constraint fk_cart_ebook foreign key(ebook_id) references ebooks(id) on delete cascade
  ) engine=InnoDB`);
  await pool.query(`create table if not exists coupons (
    id bigint unsigned not null auto_increment, code varchar(40) not null, discount_type enum('percent','flat') not null,
    discount_value int unsigned not null, minimum_paise int unsigned not null default 0, usage_limit int unsigned null,
    used_count int unsigned not null default 0, expires_at datetime null, status enum('active','inactive') not null default 'active',
    primary key(id), unique key uq_coupons_code(code)
  ) engine=InnoDB`);
  if (!await columnExists('coupons', 'ebook_id')) await pool.query('alter table coupons add column ebook_id bigint unsigned null');
  await pool.query(`create table if not exists store_settings (
    setting_key varchar(100) not null, setting_value text null, updated_at timestamp not null default current_timestamp on update current_timestamp,
    primary key(setting_key)
  ) engine=InnoDB`);
  await pool.query(`create table if not exists activity_log (
    id bigint unsigned not null auto_increment, user_id bigint unsigned null, action varchar(160) not null, details text null,
    created_at timestamp not null default current_timestamp, primary key(id)
  ) engine=InnoDB`);
  await pool.execute(`insert into categories(name,slug,description,status,sort_order) values ('Performance','performance','Fitness, energy and sustainable high performance.','active',1) on duplicate key update name=values(name)`);
  await pool.execute(`update ebooks set description=coalesce(description, ?), cover_path=coalesce(cover_path, ?) where slug=?`, ['A practical, evidence-based system for building strength, eating well, and recovering properly on a busy schedule.','/images/fitness-for-busy-professionals-cover.png','fitness-for-busy-professionals']);
  await pool.execute("update ebooks set pdf_path=coalesce(pdf_path,'server/private/ebooks/fitness-for-busy-professionals.pdf') where slug='fitness-for-busy-professionals'");
  await pool.execute(`insert into coupons(code,discount_type,discount_value,minimum_paise,usage_limit,status) values ('WELCOME20','percent',20,0,100,'active') on duplicate key update code=values(code)`);
  await pool.execute(`insert into coupons(code,discount_type,discount_value,minimum_paise,usage_limit,status) values ('LAUNCH10','percent',10,0,100,'active') on duplicate key update code=values(code)`);
}

module.exports = { ensureSchema };
