
CREATE DATABASE IF NOT EXISTS marketplace_db
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE marketplace_db;

-- 1. USERS
CREATE TABLE users (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    email           VARCHAR(191) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    full_name       VARCHAR(150) NOT NULL,
    phone           VARCHAR(20),
    role            ENUM('customer', 'seller', 'admin') NOT NULL DEFAULT 'customer',
    is_active       TINYINT(1) NOT NULL DEFAULT 1,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- 2. ADDRESSES
CREATE TABLE addresses (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id         BIGINT UNSIGNED NOT NULL,
    recipient_name  VARCHAR(150) NOT NULL,
    phone           VARCHAR(20) NOT NULL,
    province        VARCHAR(100) NOT NULL,
    district        VARCHAR(100) NOT NULL,
    ward            VARCHAR(100) NOT NULL,
    street          VARCHAR(255) NOT NULL,
    is_default      TINYINT(1) NOT NULL DEFAULT 0,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_addresses_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_addresses_user (user_id)
) ENGINE=InnoDB;

-- 3. SHOPS
CREATE TABLE shops (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id             BIGINT UNSIGNED NOT NULL UNIQUE,
    shop_name           VARCHAR(200) NOT NULL,
    slug                VARCHAR(220) NOT NULL UNIQUE,
    description         TEXT,
    logo_url            VARCHAR(500),
    pickup_address      VARCHAR(500),
    commission_rate     DECIMAL(5,2) NOT NULL DEFAULT 10.00,
    status              ENUM('pending','approved','suspended') NOT NULL DEFAULT 'pending',
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_shops_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 4. CATEGORIES
CREATE TABLE categories (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    parent_id       BIGINT UNSIGNED NULL,
    name            VARCHAR(150) NOT NULL,
    slug            VARCHAR(180) NOT NULL UNIQUE,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_categories_parent FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL,
    INDEX idx_categories_parent (parent_id)
) ENGINE=InnoDB;

-- 5. PRODUCTS
CREATE TABLE products (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    shop_id         BIGINT UNSIGNED NOT NULL,
    category_id     BIGINT UNSIGNED NOT NULL,
    name            VARCHAR(255) NOT NULL,
    slug            VARCHAR(280) NOT NULL UNIQUE,
    description     TEXT,
    brand           VARCHAR(150),
    base_price      DECIMAL(14,2) NOT NULL,
    status          ENUM('active', 'hidden', 'discontinued') NOT NULL DEFAULT 'active',
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_products_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE,
    CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories(id),
    INDEX idx_products_shop (shop_id),
    INDEX idx_products_category (category_id),
    FULLTEXT INDEX ftx_products_name (name)
) ENGINE=InnoDB;

-- 6. PRODUCT_VARIANTS
CREATE TABLE product_variants (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    product_id      BIGINT UNSIGNED NOT NULL,
    sku             VARCHAR(100) NOT NULL UNIQUE,
    attributes      JSON,
    price           DECIMAL(14,2) NOT NULL,
    stock_quantity  INT UNSIGNED NOT NULL DEFAULT 0,
    image_url       VARCHAR(500),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_variants_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    INDEX idx_variants_product (product_id)
) ENGINE=InnoDB;

-- 7. CARTS & CART_ITEMS
CREATE TABLE carts (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id         BIGINT UNSIGNED NOT NULL UNIQUE,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_carts_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

CREATE TABLE cart_items (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    cart_id         BIGINT UNSIGNED NOT NULL,
    variant_id      BIGINT UNSIGNED NOT NULL,
    quantity        INT UNSIGNED NOT NULL DEFAULT 1,
    added_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_cart_items_cart FOREIGN KEY (cart_id) REFERENCES carts(id) ON DELETE CASCADE,
    CONSTRAINT fk_cart_items_variant FOREIGN KEY (variant_id) REFERENCES product_variants(id),
    UNIQUE KEY uq_cart_variant (cart_id, variant_id)
) ENGINE=InnoDB;

-- 8. ORDERS (don hang cha)
CREATE TABLE orders (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id         BIGINT UNSIGNED NOT NULL,
    address_id      BIGINT UNSIGNED NOT NULL,
    order_code      VARCHAR(30) NOT NULL UNIQUE,
    subtotal        DECIMAL(14,2) NOT NULL,
    shipping_fee    DECIMAL(14,2) NOT NULL DEFAULT 0,
    discount        DECIMAL(14,2) NOT NULL DEFAULT 0,
    total_amount    DECIMAL(14,2) NOT NULL,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id),
    CONSTRAINT fk_orders_address FOREIGN KEY (address_id) REFERENCES addresses(id),
    INDEX idx_orders_user (user_id)
) ENGINE=InnoDB;

-- 9. SUBORDERS (don con theo tung shop)
CREATE TABLE suborders (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id            BIGINT UNSIGNED NOT NULL,
    shop_id             BIGINT UNSIGNED NOT NULL,
    status              ENUM('pending','confirmed','shipping','completed','cancelled') NOT NULL DEFAULT 'pending',
    subtotal            DECIMAL(14,2) NOT NULL,
    commission_rate     DECIMAL(5,2) NOT NULL,
    commission_amount   DECIMAL(14,2) NOT NULL,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_suborders_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    CONSTRAINT fk_suborders_shop FOREIGN KEY (shop_id) REFERENCES shops(id),
    INDEX idx_suborders_order (order_id),
    INDEX idx_suborders_shop (shop_id),
    INDEX idx_suborders_status (status)
) ENGINE=InnoDB;

-- 10. ORDER_ITEMS
CREATE TABLE order_items (
    id                      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    suborder_id             BIGINT UNSIGNED NOT NULL,
    variant_id              BIGINT UNSIGNED NOT NULL,
    product_name_snapshot   VARCHAR(255) NOT NULL,
    unit_price              DECIMAL(14,2) NOT NULL,
    quantity                INT UNSIGNED NOT NULL,
    line_total              DECIMAL(14,2) NOT NULL,
    CONSTRAINT fk_order_items_suborder FOREIGN KEY (suborder_id) REFERENCES suborders(id) ON DELETE CASCADE,
    CONSTRAINT fk_order_items_variant FOREIGN KEY (variant_id) REFERENCES product_variants(id),
    INDEX idx_order_items_suborder (suborder_id)
) ENGINE=InnoDB;

-- 11. PAYMENTS
CREATE TABLE payments (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id            BIGINT UNSIGNED NOT NULL UNIQUE,
    method              ENUM('cod','bank_transfer','e_wallet','credit_card') NOT NULL,
    status              ENUM('unpaid','paid','refunded','failed') NOT NULL DEFAULT 'unpaid',
    transaction_code    VARCHAR(100),
    paid_at             TIMESTAMP NULL,
    CONSTRAINT fk_payments_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 12. SHIPMENTS
CREATE TABLE shipments (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    suborder_id         BIGINT UNSIGNED NOT NULL UNIQUE,
    carrier             VARCHAR(100),
    tracking_number     VARCHAR(100),
    status              ENUM('packed','in_transit','delivered','returned') NOT NULL DEFAULT 'packed',
    estimated_delivery  DATE,
    CONSTRAINT fk_shipments_suborder FOREIGN KEY (suborder_id) REFERENCES suborders(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- 13. PAYOUTS
CREATE TABLE payouts (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    shop_id             BIGINT UNSIGNED NOT NULL,
    suborder_id         BIGINT UNSIGNED NOT NULL UNIQUE,
    amount              DECIMAL(14,2) NOT NULL,
    status              ENUM('pending','paid') NOT NULL DEFAULT 'pending',
    paid_at             TIMESTAMP NULL,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_payouts_shop FOREIGN KEY (shop_id) REFERENCES shops(id),
    CONSTRAINT fk_payouts_suborder FOREIGN KEY (suborder_id) REFERENCES suborders(id) ON DELETE CASCADE,
    INDEX idx_payouts_shop (shop_id)
) ENGINE=InnoDB;

-- 14. REVIEWS
CREATE TABLE reviews (
    id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    product_id      BIGINT UNSIGNED NOT NULL,
    user_id         BIGINT UNSIGNED NOT NULL,
    order_item_id   BIGINT UNSIGNED NOT NULL UNIQUE,
    rating          TINYINT UNSIGNED NOT NULL,
    comment         TEXT,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_reviews_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    CONSTRAINT fk_reviews_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_reviews_order_item FOREIGN KEY (order_item_id) REFERENCES order_items(id),
    CONSTRAINT chk_reviews_rating CHECK (rating BETWEEN 1 AND 5),
    INDEX idx_reviews_product (product_id)
) ENGINE=InnoDB;

-- 15. VOUCHERS
CREATE TABLE vouchers (
    id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    shop_id             BIGINT UNSIGNED NULL,
    code                VARCHAR(50) NOT NULL UNIQUE,
    discount_type       ENUM('percent','fixed') NOT NULL,
    value               DECIMAL(14,2) NOT NULL,
    min_order_amount    DECIMAL(14,2) NOT NULL DEFAULT 0,
    expires_at          TIMESTAMP NULL,
    created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_vouchers_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
) ENGINE=InnoDB;

INSERT INTO users (email, password_hash, full_name, role) VALUES
 ('sellerA@mail.com', 'hash', 'Nguyen Van A', 'seller'),
 ('sellerB@mail.com', 'hash', 'Tran Thi B', 'seller');

INSERT INTO shops (user_id, shop_name, slug, commission_rate, status) VALUES
 (1, 'Shop Thời Trang A', 'shop-a', 10.00, 'approved'),
 (2, 'Shop Công Nghệ B', 'shop-b', 8.00, 'approved');

INSERT INTO categories (name, slug) VALUES
 ('Thời trang nam', 'thoi-trang-nam'),
 ('Phụ kiện điện thoại', 'phu-kien-dien-thoai');

INSERT INTO products (shop_id, category_id, name, slug, base_price) VALUES
 (1, 1, 'Áo thun basic', 'ao-thun-basic', 150000),
 (1, 1, 'Quần jean nam', 'quan-jean-nam', 350000),
 (2, 2, 'Ốp lưng iPhone', 'op-lung-iphone', 90000),
 (2, 2, 'Sạc nhanh 20W', 'sac-nhanh-20w', 220000);

INSERT INTO product_variants (product_id, sku, attributes, price, stock_quantity) VALUES
 (1, 'ATB-DEN-M', JSON_OBJECT('color','đen','size','M'), 150000, 50),
 (2, 'QJN-XANH-32', JSON_OBJECT('color','xanh','size','32'), 350000, 30),
 (3, 'OPL-TRONG', JSON_OBJECT('color','trong'), 90000, 100),
 (4, 'SAC-20W', JSON_OBJECT('type','20W'), 220000, 60);