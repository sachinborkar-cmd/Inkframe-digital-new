create database if not exists ebook_store
  character set utf8mb4
  collate utf8mb4_unicode_ci;

use ebook_store;

create table if not exists users (
  id bigint unsigned not null auto_increment,
  email varchar(254) not null,
  is_verified boolean not null default false,
  created_at timestamp not null default current_timestamp,
  primary key (id),
  unique key uq_users_email (email)
) engine=InnoDB;

create table if not exists profiles (
  id bigint unsigned not null auto_increment,
  user_id bigint unsigned not null,
  full_name varchar(120) not null,
  mobile varchar(24) not null,
  updated_at timestamp not null default current_timestamp on update current_timestamp,
  primary key (id),
  unique key uq_profiles_user_id (user_id),
  constraint fk_profiles_user foreign key (user_id) references users(id) on delete cascade
) engine=InnoDB;

create table if not exists otp_codes (
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
) engine=InnoDB;

create table if not exists ebooks (
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
) engine=InnoDB;

create table if not exists categories (
  id bigint unsigned not null auto_increment, name varchar(120) not null, slug varchar(140) not null,
  description text null, status enum('draft','active') not null default 'active', sort_order int not null default 0,
  primary key (id), unique key uq_categories_slug (slug)
) engine=InnoDB;

create table if not exists carts (
  user_id bigint unsigned not null, ebook_id bigint unsigned not null, created_at timestamp not null default current_timestamp,
  primary key (user_id, ebook_id),
  constraint fk_cart_user foreign key (user_id) references users(id) on delete cascade,
  constraint fk_cart_ebook foreign key (ebook_id) references ebooks(id) on delete cascade
) engine=InnoDB;

create table if not exists coupons (
  id bigint unsigned not null auto_increment, code varchar(40) not null,
  discount_type enum('percent','flat') not null, discount_value int unsigned not null,
  minimum_paise int unsigned not null default 0, usage_limit int unsigned null, used_count int unsigned not null default 0,
  expires_at datetime null, status enum('active','inactive') not null default 'active',
  primary key (id), unique key uq_coupons_code (code)
) engine=InnoDB;

create table if not exists store_settings (
  setting_key varchar(100) not null, setting_value text null,
  updated_at timestamp not null default current_timestamp on update current_timestamp,
  primary key (setting_key)
) engine=InnoDB;

create table if not exists activity_log (
  id bigint unsigned not null auto_increment, user_id bigint unsigned null,
  action varchar(160) not null, details text null, created_at timestamp not null default current_timestamp,
  primary key (id)
) engine=InnoDB;

create table if not exists orders (
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
) engine=InnoDB;

insert into ebooks (slug, title, author, price_paise, pdf_path, epub_path, cover_path, status)
values
  ('fitness-for-busy-professionals', 'Fitness for Busy Professionals', 'Inkframe Press', 49900, 'server/private/ebooks/fitness-for-busy-professionals.pdf', null, '/images/fitness-for-busy-professionals-cover.png', 'published'),
  ('kids-drawing-book', 'Kids Drawing Book', 'Inkframe Press', 9900, 'server/private/ebooks/8ba536b1-b086-47cc-961d-d791aaaf69dc.pdf', null, '/assets/uploads/7a1c33d0-d3ab-4fc4-9e8f-ff51301f3f56.png', 'published')
on duplicate key update
  title = values(title),
  author = values(author),
  price_paise = values(price_paise),
  cover_path = values(cover_path),
  status = values(status);
