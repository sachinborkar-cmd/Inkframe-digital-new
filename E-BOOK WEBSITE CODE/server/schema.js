const pool = require('./database');

async function columnExists(table, column) {
  const [rows] = await pool.execute(
    'select 1 from information_schema.columns where table_schema = ? and table_name = ? and column_name = ? limit 1',
    [process.env.DB_NAME, table, column]
  );
  return rows.length > 0;
}

async function initializeBaseSchema() {
  await pool.query(`create table if not exists users (
    id bigint unsigned not null auto_increment,
    email varchar(254) not null,
    is_verified boolean not null default false,
    created_at timestamp not null default current_timestamp,
    primary key (id),
    unique key uq_users_email (email)
  ) engine=InnoDB`);

  await pool.query(`create table if not exists profiles (
    id bigint unsigned not null auto_increment,
    user_id bigint unsigned not null,
    full_name varchar(120) not null,
    mobile varchar(24) not null,
    updated_at timestamp not null default current_timestamp on update current_timestamp,
    primary key (id),
    unique key uq_profiles_user_id (user_id),
    constraint fk_profiles_user foreign key (user_id) references users(id) on delete cascade
  ) engine=InnoDB`);

  await pool.query(`create table if not exists otp_codes (
    id bigint unsigned not null auto_increment,
    user_id bigint unsigned not null,
    otp_hash varchar(255) not null,
    expires_at datetime not null,
    consumed_at datetime null,
    attempts tinyint unsigned not null default 0,
    created_at timestamp not null default current_timestamp,
    primary key (id),
    key idx_otp_user_created (user_id, created_at),
    key idx_otp_expiry (expires_at),
    constraint fk_otp_user foreign key (user_id) references users(id) on delete cascade
  ) engine=InnoDB`);

  await pool.query(`create table if not exists ebooks (
    id bigint unsigned not null auto_increment,
    slug varchar(160) not null,
    title varchar(255) not null,
    author varchar(160) not null,
    price_paise int unsigned not null,
    description text null,
    cover_path varchar(500) null,
    preview_pages json null,
    testimonials json null,
    pdf_path varchar(500) null,
    epub_path varchar(500) null,
    status enum('draft', 'published', 'archived') not null default 'published',
    created_at timestamp not null default current_timestamp,
    primary key (id),
    unique key uq_ebooks_slug (slug)
  ) engine=InnoDB`);

  await pool.query(`create table if not exists categories (
    id bigint unsigned not null auto_increment,
    name varchar(120) not null,
    slug varchar(140) not null,
    description text null,
    status enum('draft','active') not null default 'active',
    sort_order int not null default 0,
    primary key (id),
    unique key uq_categories_slug (slug)
  ) engine=InnoDB`);

  await pool.query(`create table if not exists orders (
    id bigint unsigned not null auto_increment,
    user_id bigint unsigned not null,
    ebook_id bigint unsigned not null,
    amount_paise int unsigned not null,
    status enum('pending', 'paid', 'refunded', 'cancelled') not null default 'pending',
    created_at timestamp not null default current_timestamp,
    primary key (id),
    key idx_orders_user_status (user_id, status),
    constraint fk_orders_user foreign key (user_id) references users(id) on delete restrict,
    constraint fk_orders_ebook foreign key (ebook_id) references ebooks(id) on delete restrict
  ) engine=InnoDB`);

  await pool.query(`create table if not exists carts (
    user_id bigint unsigned not null,
    ebook_id bigint unsigned not null,
    created_at timestamp not null default current_timestamp,
    primary key (user_id, ebook_id),
    constraint fk_cart_user foreign key (user_id) references users(id) on delete cascade,
    constraint fk_cart_ebook foreign key (ebook_id) references ebooks(id) on delete cascade
  ) engine=InnoDB`);

  await pool.query(`create table if not exists coupons (
    id bigint unsigned not null auto_increment,
    code varchar(40) not null,
    discount_type enum('percent','flat') not null,
    discount_value int unsigned not null,
    minimum_paise int unsigned not null default 0,
    usage_limit int unsigned null,
    used_count int unsigned not null default 0,
    expires_at datetime null,
    status enum('active','inactive') not null default 'active',
    primary key (id),
    unique key uq_coupons_code (code)
  ) engine=InnoDB`);

  await pool.query(`create table if not exists store_settings (
    setting_key varchar(100) not null,
    setting_value text null,
    updated_at timestamp not null default current_timestamp on update current_timestamp,
    primary key (setting_key)
  ) engine=InnoDB`);

  await pool.query(`create table if not exists activity_log (
    id bigint unsigned not null auto_increment,
    user_id bigint unsigned null,
    action varchar(160) not null,
    details text null,
    created_at timestamp not null default current_timestamp,
    primary key (id)
  ) engine=InnoDB`);
}

async function ensureSchema() {
  await initializeBaseSchema();
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
  // Seed once so an administrator can permanently delete the default category.
  const seedConnection = await pool.getConnection();
  try {
    await seedConnection.beginTransaction();
    const [seed] = await seedConnection.execute("insert ignore into schema_migrations(name) values ('default-performance-category-v1')");
    if (seed.affectedRows) await seedConnection.execute(`insert into categories(name,slug,description,status,sort_order) values ('Performance','performance','Fitness, energy and sustainable high performance.','active',1) on duplicate key update slug=values(slug)`);
    await seedConnection.commit();
  } catch (error) {
    await seedConnection.rollback();
    throw error;
  } finally { seedConnection.release(); }
  await pool.execute(`insert into ebooks (slug, title, author, price_paise, pdf_path, status, description, cover_path)
    values (?, ?, ?, ?, ?, 'published', ?, ?)
    on duplicate key update
      title=values(title),
      price_paise=values(price_paise),
      description=coalesce(ebooks.description, values(description)),
      cover_path=coalesce(ebooks.cover_path, values(cover_path)),
      pdf_path=coalesce(ebooks.pdf_path, values(pdf_path))`,
    [
      'fitness-for-busy-professionals',
      'Fitness for Busy Professionals',
      'Inkframe Press',
      49900,
      'server/private/ebooks/fitness-for-busy-professionals.pdf',
      'A practical, evidence-based system for building strength, eating well, and recovering properly on a busy schedule.',
      '/images/fitness-for-busy-professionals-cover.png'
    ]
  );
  await pool.execute(`insert into ebooks (slug, title, author, price_paise, pdf_path, status, description, cover_path, sample_path, preview_pages, testimonials)
    values (?, ?, ?, ?, ?, 'published', ?, ?, ?, ?, ?)
    on duplicate key update
      title=values(title),
      price_paise=values(price_paise),
      description=values(description),
      cover_path=values(cover_path),
      sample_path=values(sample_path),
      preview_pages=values(preview_pages),
      testimonials=values(testimonials),
      pdf_path=coalesce(ebooks.pdf_path, values(pdf_path))`,
    [
      'kids-drawing-book',
      'Kids Drawing Book',
      'Inkframe Press',
      9900,
      'server/private/ebooks/8ba536b1-b086-47cc-961d-d791aaaf69dc.pdf',
      'This engaging animal activity and colouring book features 13 large, single-page animal illustrations with thick, clean outlines, making them easy and fun for young children to colour. Along with colouring activities, children can develop early learning skills with a “Count & Colour” activity page, enjoy a fun “Connect the Dots” puzzle, and use a free-draw page to create their own favourite animal. A personalised “This Book Belongs To” page adds a special touch, while a certificate of completion celebrates children’s achievement when they finish the book. A quick how-to-use guide for teachers and parents is also included to make activities easy to use and enjoyable. Perfect for preschools, kindergartens, primary schools, daycare and playgroup activity time, birthday party activity favours, and quiet-time or travel entertainment at home.',
      '/assets/uploads/7a1c33d0-d3ab-4fc4-9e8f-ff51301f3f56.png',
      '/assets/uploads/35bc0fed-d733-4630-8b64-c61788e6dad4.pdf',
      JSON.stringify([
        { path: '/assets/uploads/09cbb78a-b3c0-41c4-8668-76a9c9c56eb2.png', caption: '' },
        { path: '/assets/uploads/10f5361c-8723-4919-88f1-5a50e5d6170c.png', caption: '' },
        { path: '/assets/uploads/43871c4a-a88d-4a16-9190-5bc5b172ae54.png', caption: '' }
      ]),
      JSON.stringify([
        { name: 'Mr. Rao, Primary School Art Teacher', quote: '"I love that the illustrations get slightly more detailed as the book goes on. It means I can hand the same book to my youngest and oldest students and both stay engaged."' },
        { name: 'Anjali M., Parent', quote: 'My daughter finished the whole book in a week and was so proud of her certificate  she taped it to her bedroom wall!"' },
        { name: 'Ms. Fernandes, Kindergarten Teacher', quote: 'This colouring book has become a staple during our free-choice time. The activity pages are a nice bonus — my kindergartners don\'t even realise they\'re practising counting while they colour!"' }
      ])
    ]
  );
  await pool.execute(`insert into coupons(code,discount_type,discount_value,minimum_paise,usage_limit,status) values ('WELCOME20','percent',20,0,100,'active') on duplicate key update code=values(code)`);
  await pool.execute(`insert into coupons(code,discount_type,discount_value,minimum_paise,usage_limit,status) values ('LAUNCH10','percent',10,0,100,'active') on duplicate key update code=values(code)`);
}

module.exports = { ensureSchema };
