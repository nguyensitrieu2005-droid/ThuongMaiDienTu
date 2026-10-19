require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');
const path = require('path');
const pool = require('./db');

const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }, // 7 ngay
}));

// Bien dung chung cho moi view: user, so luong gio hang, danh muc, ham vnd()
app.use(async (req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.cartCount = 0;
  res.locals.q = '';
  res.locals.navCategories = [];
  res.locals.vnd = (n) => Number(n).toLocaleString('vi-VN') + ' đ';
  try {
    const [cats] = await pool.query(
      'SELECT id, name, slug FROM categories WHERE parent_id IS NULL ORDER BY name');
    res.locals.navCategories = cats;
    if (req.session.user) {
      const [[row]] = await pool.query(
        `SELECT COALESCE(SUM(ci.quantity), 0) AS n
         FROM carts c JOIN cart_items ci ON ci.cart_id = c.id
         WHERE c.user_id = ?`, [req.session.user.id]);
      res.locals.cartCount = Number(row.n);
    }
  } catch (e) { console.error(e); }
  next();
});

// ---------- Middleware: bat buoc dang nhap ----------
function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

// ================= TAI KHOAN: DANG KY / DANG NHAP =================

// ---------- Dang ky ----------
app.get('/register', (req, res) => {
  res.render('register', { error: null, form: {} });
});

app.post('/register', async (req, res) => {
  const { full_name, email, phone, password, confirm } = req.body;
  const form = { full_name, email, phone };
  const fail = (error) => res.render('register', { error, form });

  if (!full_name || !email || !password) return fail('Vui lòng nhập đủ họ tên, email và mật khẩu.');
  if (password.length < 6) return fail('Mật khẩu phải có ít nhất 6 ký tự.');
  if (password !== confirm) return fail('Mật khẩu nhập lại không khớp.');

  try {
    const hash = await bcrypt.hash(password, 10);
    const cleanEmail = email.trim().toLowerCase();
    const [result] = await pool.query(
      'INSERT INTO users (email, password_hash, full_name, phone) VALUES (?, ?, ?, ?)',
      [cleanEmail, hash, full_name.trim(), phone || null]
    );
    req.session.user = {
      id: result.insertId,
      full_name: full_name.trim(),
      email: cleanEmail,
      role: 'customer',
    };
    res.redirect('/');
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return fail('Email này đã được đăng ký.');
    console.error(err);
    fail('Có lỗi xảy ra, vui lòng thử lại.');
  }
});

// ---------- Dang nhap ----------
app.get('/login', (req, res) => {
  res.render('login', { error: null, email: '' });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const fail = () => res.render('login', { error: 'Email hoặc mật khẩu không đúng.', email });

  try {
    const [rows] = await pool.query(
      'SELECT id, email, password_hash, full_name, role FROM users WHERE email = ? AND is_active = 1',
      [(email || '').trim().toLowerCase()]
    );
    const u = rows[0];
    if (!u) return fail();

    const ok = await bcrypt.compare(password || '', u.password_hash);
    if (!ok) return fail();

    req.session.user = { id: u.id, full_name: u.full_name, email: u.email, role: u.role };
    res.redirect('/');
  } catch (err) {
    console.error(err);
    fail();
  }
});

// ---------- Dang xuat ----------
app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/'));
});

// ================= GIO HANG =================

// ---------- Them vao gio ----------
app.post('/cart/add', requireLogin, async (req, res) => {
  const variantId = Number(req.body.variant_id);
  const userId = req.session.user.id;
  try {
    const [[variant]] = await pool.query(
      'SELECT id, stock_quantity FROM product_variants WHERE id = ?', [variantId]);
    if (!variant || variant.stock_quantity < 1) return res.status(400).send('Sản phẩm đã hết hàng.');

    const qty = Math.min(Math.max(1, parseInt(req.body.quantity) || 1), variant.stock_quantity);

    await pool.query('INSERT IGNORE INTO carts (user_id) VALUES (?)', [userId]);
    const [[cart]] = await pool.query('SELECT id FROM carts WHERE user_id = ?', [userId]);

    await pool.query(
      `INSERT INTO cart_items (cart_id, variant_id, quantity) VALUES (?, ?, ?) AS new
       ON DUPLICATE KEY UPDATE quantity = LEAST(cart_items.quantity + new.quantity, ?)`,
      [cart.id, variantId, qty, variant.stock_quantity]
    );
    res.redirect('/cart');
  } catch (err) {
    console.error(err);
    res.status(500).send('Loi database: ' + err.message);
  }
});

// ---------- Xem gio hang (gom theo shop) ----------
app.get('/cart', requireLogin, async (req, res) => {
  try {
    const [items] = await pool.query(`
      SELECT ci.id, ci.quantity, v.price, v.attributes, v.sku, v.stock_quantity,
             p.id AS product_id, p.name, s.id AS shop_id, s.shop_name
      FROM carts c
      JOIN cart_items ci ON ci.cart_id = c.id
      JOIN product_variants v ON v.id = ci.variant_id
      JOIN products p ON p.id = v.product_id
      JOIN shops s ON s.id = p.shop_id
      WHERE c.user_id = ?
      ORDER BY s.shop_name, ci.added_at
    `, [req.session.user.id]);

    const groups = {};
    let total = 0;
    items.forEach((i) => {
      i.line_total = Number(i.price) * i.quantity;
      total += i.line_total;
      if (!groups[i.shop_id]) groups[i.shop_id] = { shop_name: i.shop_name, items: [], subtotal: 0 };
      groups[i.shop_id].items.push(i);
      groups[i.shop_id].subtotal += i.line_total;
    });
    res.render('cart', { groups: Object.values(groups), total });
  } catch (err) {
    console.error(err);
    res.status(500).send('Loi database: ' + err.message);
  }
});

// ---------- Cap nhat so luong ----------
app.post('/cart/update', requireLogin, async (req, res) => {
  const itemId = Number(req.body.item_id);
  const qty = parseInt(req.body.quantity);
  try {
    if (!qty || qty < 1) {
      await pool.query(
        `DELETE ci FROM cart_items ci JOIN carts c ON c.id = ci.cart_id
         WHERE ci.id = ? AND c.user_id = ?`, [itemId, req.session.user.id]);
    } else {
      await pool.query(
        `UPDATE cart_items ci
         JOIN carts c ON c.id = ci.cart_id
         JOIN product_variants v ON v.id = ci.variant_id
         SET ci.quantity = LEAST(?, v.stock_quantity)
         WHERE ci.id = ? AND c.user_id = ?`, [qty, itemId, req.session.user.id]);
    }
    res.redirect('/cart');
  } catch (err) {
    console.error(err);
    res.status(500).send('Loi database: ' + err.message);
  }
});

// ---------- Xoa khoi gio ----------
app.post('/cart/remove', requireLogin, async (req, res) => {
  try {
    await pool.query(
      `DELETE ci FROM cart_items ci JOIN carts c ON c.id = ci.cart_id
       WHERE ci.id = ? AND c.user_id = ?`, [Number(req.body.item_id), req.session.user.id]);
    res.redirect('/cart');
  } catch (err) {
    console.error(err);
    res.status(500).send('Loi database: ' + err.message);
  }
});

// ================= CHECKOUT & DON HANG =================
const SHIPPING_FEE_PER_SHOP = 20000;
const PAYMENT_METHODS = {
  cod: 'Thanh toán khi nhận hàng (COD)',
  bank_transfer: 'Chuyển khoản ngân hàng',
  e_wallet: 'Ví điện tử',
};

// Nhan hien thi cho moi view
app.locals.suborderStatus = {
  pending: 'Chờ xác nhận', confirmed: 'Đã xác nhận', shipping: 'Đang giao',
  completed: 'Hoàn thành', cancelled: 'Đã hủy',
};
app.locals.statusBadge = {
  pending: 'warning', confirmed: 'info', shipping: 'primary',
  completed: 'success', cancelled: 'danger',
};
app.locals.paymentStatus = { unpaid: 'Chưa thanh toán', paid: 'Đã thanh toán', refunded: 'Đã hoàn tiền', failed: 'Thất bại' };
app.locals.paymentMethod = PAYMENT_METHODS;

class UserError extends Error {}

async function loadCartItems(conn, userId, lock = false) {
  const sql = `
    SELECT ci.id, ci.quantity, v.id AS variant_id, v.price, v.stock_quantity,
           v.attributes, v.sku, p.name, s.id AS shop_id, s.shop_name, s.commission_rate
    FROM carts c
    JOIN cart_items ci ON ci.cart_id = c.id
    JOIN product_variants v ON v.id = ci.variant_id
    JOIN products p ON p.id = v.product_id
    JOIN shops s ON s.id = p.shop_id
    WHERE c.user_id = ?
    ORDER BY s.id, ci.id` + (lock ? ' FOR UPDATE OF v' : '');
  const [rows] = await conn.query(sql, [userId]);
  return rows;
}

function groupByShop(items) {
  const map = new Map();
  let subtotal = 0;
  items.forEach((i) => {
    i.line_total = Number(i.price) * i.quantity;
    subtotal += i.line_total;
    if (!map.has(i.shop_id)) {
      map.set(i.shop_id, {
        shop_id: i.shop_id, shop_name: i.shop_name,
        commission_rate: Number(i.commission_rate), items: [], subtotal: 0,
      });
    }
    const g = map.get(i.shop_id);
    g.items.push(i);
    g.subtotal += i.line_total;
  });
  return { groups: [...map.values()], subtotal };
}

async function renderCheckout(res, userId, error, form = {}) {
  const items = await loadCartItems(pool, userId);
  if (!items.length) return res.redirect('/cart');
  const { groups, subtotal } = groupByShop(items);
  const shippingFee = groups.length * SHIPPING_FEE_PER_SHOP;
  const [addresses] = await pool.query(
    'SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC', [userId]);
  res.render('checkout', {
    groups, addresses, subtotal, shippingFee, total: subtotal + shippingFee,
    methods: PAYMENT_METHODS, error, form,
  });
}

// ---------- Trang dat hang ----------
app.get('/checkout', requireLogin, async (req, res) => {
  try {
    await renderCheckout(res, req.session.user.id, null);
  } catch (err) {
    console.error(err);
    res.status(500).send('Loi database: ' + err.message);
  }
});

// ---------- Xu ly dat hang ----------
app.post('/checkout', requireLogin, async (req, res) => {
  const userId = req.session.user.id;
  const { address_id, payment_method } = req.body;

  if (!PAYMENT_METHODS[payment_method]) {
    try { return await renderCheckout(res, userId, 'Vui lòng chọn phương thức thanh toán.', req.body); }
    catch (e) { console.error(e); return res.status(500).send('Có lỗi xảy ra.'); }
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. Dia chi giao hang
    let addressId;
    if (address_id === 'new') {
      const { recipient_name, phone, province, district, ward, street } = req.body;
      if (![recipient_name, phone, province, district, ward, street].every((v) => v && v.trim())) {
        throw new UserError('Vui lòng nhập đầy đủ địa chỉ giao hàng.');
      }
      const [r] = await conn.query(
        `INSERT INTO addresses (user_id, recipient_name, phone, province, district, ward, street)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, recipient_name.trim(), phone.trim(), province.trim(), district.trim(), ward.trim(), street.trim()]);
      addressId = r.insertId;
    } else {
      const [rows] = await conn.query(
        'SELECT id FROM addresses WHERE id = ? AND user_id = ?', [Number(address_id), userId]);
      if (!rows[0]) throw new UserError('Vui lòng chọn địa chỉ giao hàng.');
      addressId = rows[0].id;
    }

    // 2. Lay gio hang + khoa dong ton kho
    const items = await loadCartItems(conn, userId, true);
    if (!items.length) throw new UserError('Giỏ hàng đang trống.');
    for (const i of items) {
      if (i.quantity > i.stock_quantity) {
        throw new UserError(`"${i.name}" chỉ còn ${i.stock_quantity} sản phẩm trong kho. Vui lòng cập nhật giỏ hàng.`);
      }
    }
    const { groups, subtotal } = groupByShop(items);
    const shippingFee = groups.length * SHIPPING_FEE_PER_SHOP;
    const total = subtotal + shippingFee;
    const orderCode = 'DH' + Date.now() + Math.floor(Math.random() * 90 + 10);

    // 3. Don cha
    const [orderRes] = await conn.query(
      `INSERT INTO orders (user_id, address_id, order_code, subtotal, shipping_fee, discount, total_amount)
       VALUES (?, ?, ?, ?, ?, 0, ?)`,
      [userId, addressId, orderCode, subtotal, shippingFee, total]);
    const orderId = orderRes.insertId;

    // 4. Tach thanh suborder theo shop
    for (const g of groups) {
      const commissionAmount = Math.round((g.subtotal * g.commission_rate) / 100);
      const [subRes] = await conn.query(
        `INSERT INTO suborders (order_id, shop_id, subtotal, commission_rate, commission_amount)
         VALUES (?, ?, ?, ?, ?)`,
        [orderId, g.shop_id, g.subtotal, g.commission_rate, commissionAmount]);

      for (const i of g.items) {
        const attrText = Object.values(i.attributes || {}).join(' / ');
        const nameSnapshot = (i.name + (attrText ? ' - ' + attrText : '')).slice(0, 255);
        await conn.query(
          `INSERT INTO order_items (suborder_id, variant_id, product_name_snapshot, unit_price, quantity, line_total)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [subRes.insertId, i.variant_id, nameSnapshot, i.price, i.quantity, i.line_total]);
        await conn.query(
          'UPDATE product_variants SET stock_quantity = stock_quantity - ? WHERE id = ?',
          [i.quantity, i.variant_id]);
      }
    }

    // 5. Thanh toan + xoa gio hang
    await conn.query('INSERT INTO payments (order_id, method) VALUES (?, ?)', [orderId, payment_method]);
    await conn.query(
      `DELETE ci FROM cart_items ci JOIN carts c ON c.id = ci.cart_id WHERE c.user_id = ?`, [userId]);

    await conn.commit();
    res.redirect(`/orders/${orderId}?success=1`);
  } catch (err) {
    await conn.rollback();
    if (err instanceof UserError) {
      try { return await renderCheckout(res, userId, err.message, req.body); }
      catch (e) { console.error(e); }
    } else {
      console.error(err);
    }
    res.status(500).send('Có lỗi khi đặt hàng, vui lòng thử lại.');
  } finally {
    conn.release();
  }
});

// ---------- Danh sach don hang cua toi ----------
app.get('/orders', requireLogin, async (req, res) => {
  try {
    const [orders] = await pool.query(`
      SELECT o.id, o.order_code, o.total_amount, o.created_at,
             pay.method, pay.status AS pay_status
      FROM orders o LEFT JOIN payments pay ON pay.order_id = o.id
      WHERE o.user_id = ? ORDER BY o.created_at DESC`, [req.session.user.id]);
    res.render('orders', { orders });
  } catch (err) {
    console.error(err);
    res.status(500).send('Loi database: ' + err.message);
  }
});

// ================= PHIA NGUOI MUA =================
const PLACE_COLORS = ['#0d6efd', '#6f42c1', '#d63384', '#fd7e14', '#198754', '#20c997', '#0dcaf0', '#6610f2'];
app.locals.placeColor = (id) => PLACE_COLORS[Number(id) % PLACE_COLORS.length];
app.locals.placeClass = (id) => 'ph-' + (Number(id) % 8);
app.locals.stars = (n) => {
  const r = Math.round(Number(n) || 0);
  return '★'.repeat(r) + '☆'.repeat(5 - r);
};
app.locals.maskName = (name) => {
  const s = String(name || '').trim();
  return s ? s.charAt(0) + '***' : 'Ẩn danh';
};

// Cot dung chung cho the san pham
const CARD_COLS = `
  p.id, p.name, p.created_at, s.shop_name, s.slug AS shop_slug,
  (SELECT MIN(price) FROM product_variants WHERE product_id = p.id) AS price,
  (SELECT image_url FROM product_variants
     WHERE product_id = p.id AND image_url IS NOT NULL ORDER BY id LIMIT 1) AS image_url,
  (SELECT ROUND(AVG(rating), 1) FROM reviews WHERE product_id = p.id) AS avg_rating,
  (SELECT COUNT(*) FROM reviews WHERE product_id = p.id) AS review_count,
  (SELECT COALESCE(SUM(oi.quantity), 0) FROM order_items oi
     JOIN suborders so ON so.id = oi.suborder_id
     JOIN product_variants pv ON pv.id = oi.variant_id
   WHERE pv.product_id = p.id AND so.status = 'completed') AS sold`;

// Order item cua user da giao xong va chua danh gia
const ELIGIBLE_SQL = `
  SELECT oi.id FROM order_items oi
  JOIN suborders so ON so.id = oi.suborder_id
  JOIN orders o ON o.id = so.order_id
  JOIN product_variants v ON v.id = oi.variant_id
  LEFT JOIN reviews r ON r.order_item_id = oi.id
  WHERE o.user_id = ? AND v.product_id = ? AND so.status = 'completed' AND r.id IS NULL
  ORDER BY oi.id LIMIT 1`;

const enc = encodeURIComponent;

// ---------- Trang chu: tim kiem, loc, sap xep, phan trang ----------
app.get('/', async (req, res) => {
  const q = (req.query.q || '').trim();
  const cat = (req.query.cat || '').trim();
  const sorts = {
    new: 'created_at DESC',
    price_asc: 'price IS NULL, price ASC',
    price_desc: 'price DESC',
    rating: 'avg_rating DESC, review_count DESC',
    sold: 'sold DESC',
  };
  const sort = sorts[req.query.sort] ? req.query.sort : 'new';
  const min = parseInt(req.query.min) || 0;
  const max = parseInt(req.query.max) || 0;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const PER_PAGE = 12;

  const where = ["p.status = 'active'", "s.status = 'approved'"];
  const params = [];
  if (q) { where.push('p.name LIKE ?'); params.push(`%${q}%`); }
  if (cat) { where.push('c.slug = ?'); params.push(cat); }

  const outer = ['1 = 1'];
  const outerParams = [];
  if (min > 0) { outer.push('price >= ?'); outerParams.push(min); }
  if (max > 0) { outer.push('price <= ?'); outerParams.push(max); }

  const base = `
    SELECT ${CARD_COLS}, c.name AS category
    FROM products p
    JOIN shops s ON s.id = p.shop_id
    JOIN categories c ON c.id = p.category_id
    WHERE ${where.join(' AND ')}`;

  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM (${base}) t WHERE ${outer.join(' AND ')}`,
    [...params, ...outerParams]);
  const [products] = await pool.query(
    `SELECT * FROM (${base}) t WHERE ${outer.join(' AND ')}
     ORDER BY ${sorts[sort]} LIMIT ? OFFSET ?`,
    [...params, ...outerParams, PER_PAGE, (page - 1) * PER_PAGE]);

  const keep = { q, cat, sort: sort === 'new' ? '' : sort, min: min || '', max: max || '' };
  const pageUrl = (n) => {
    const sp = new URLSearchParams();
    Object.entries(keep).forEach(([k, v]) => { if (v) sp.set(k, v); });
    if (n > 1) sp.set('page', n);
    const s = sp.toString();
    return '/' + (s ? '?' + s : '');
  };

  res.render('index', {
    products, q, cat, sort, min, max, page, total, pageUrl,
    totalPages: Math.max(1, Math.ceil(total / PER_PAGE)),
  });
});

// ---------- Chi tiet san pham ----------
app.get('/product/:id', async (req, res) => {
  const id = Number(req.params.id);
  const [[product]] = await pool.query(`
    SELECT p.id, p.name, p.description, p.brand, p.category_id,
           s.shop_name, s.slug AS shop_slug, c.name AS category, c.slug AS category_slug
    FROM products p
    JOIN shops s ON s.id = p.shop_id
    JOIN categories c ON c.id = p.category_id
    WHERE p.id = ? AND p.status = 'active' AND s.status = 'approved'`, [id]);
  if (!product) return res.status(404).send('Không tìm thấy sản phẩm.');

  const [variants] = await pool.query(
    'SELECT id, sku, attributes, price, stock_quantity, image_url FROM product_variants WHERE product_id = ? ORDER BY id',
    [id]);
  const [[stats]] = await pool.query(
    'SELECT COUNT(*) AS n, ROUND(AVG(rating), 1) AS avg FROM reviews WHERE product_id = ?', [id]);
  const [reviews] = await pool.query(`
    SELECT r.rating, r.comment, r.created_at, u.full_name
    FROM reviews r JOIN users u ON u.id = r.user_id
    WHERE r.product_id = ? ORDER BY r.created_at DESC LIMIT 30`, [id]);

  let canReview = false;
  if (req.session.user) {
    const [rows] = await pool.query(ELIGIBLE_SQL, [req.session.user.id, id]);
    canReview = rows.length > 0;
  }
  const [related] = await pool.query(`
    SELECT ${CARD_COLS} FROM products p JOIN shops s ON s.id = p.shop_id
    WHERE p.category_id = ? AND p.id <> ? AND p.status = 'active' AND s.status = 'approved'
    ORDER BY p.created_at DESC LIMIT 4`, [product.category_id, id]);

  res.render('product', { product, variants, stats, reviews, canReview, related, msg: req.query.msg || null });
});

// ---------- Gui danh gia ----------
app.post('/product/:id/review', requireLogin, async (req, res) => {
  const id = Number(req.params.id);
  const rating = parseInt(req.body.rating);
  const comment = (req.body.comment || '').trim().slice(0, 1000);
  const back = (msg) => res.redirect(`/product/${id}?msg=${enc(msg)}#reviews`);

  if (!(rating >= 1 && rating <= 5)) return back('Vui lòng chọn số sao từ 1 đến 5.');
  const [rows] = await pool.query(ELIGIBLE_SQL, [req.session.user.id, id]);
  if (!rows[0]) return back('Bạn chỉ có thể đánh giá sản phẩm đã mua và nhận hàng.');
  await pool.query(
    'INSERT INTO reviews (product_id, user_id, order_item_id, rating, comment) VALUES (?, ?, ?, ?, ?)',
    [id, req.session.user.id, rows[0].id, rating, comment || null]);
  back('Cảm ơn bạn đã đánh giá!');
});

// ---------- Trang shop ----------
app.get('/shop/:slug', async (req, res) => {
  const [[shop]] = await pool.query(
    "SELECT id, shop_name, description, created_at FROM shops WHERE slug = ? AND status = 'approved'",
    [req.params.slug]);
  if (!shop) return res.status(404).send('Không tìm thấy shop.');

  const [[rv]] = await pool.query(`
    SELECT COUNT(*) AS n, ROUND(AVG(r.rating), 1) AS avg
    FROM reviews r JOIN products p ON p.id = r.product_id WHERE p.shop_id = ?`, [shop.id]);
  const [products] = await pool.query(`
    SELECT ${CARD_COLS} FROM products p JOIN shops s ON s.id = p.shop_id
    WHERE p.shop_id = ? AND p.status = 'active' ORDER BY p.created_at DESC LIMIT 48`, [shop.id]);
  res.render('shop', { shop, products, rv });
});

// ---------- Tai khoan ----------
app.get('/account', requireLogin, async (req, res) => {
  const uid = req.session.user.id;
  const [[me]] = await pool.query('SELECT id, email, full_name, phone, created_at FROM users WHERE id = ?', [uid]);
  const [addresses] = await pool.query(
    'SELECT * FROM addresses WHERE user_id = ? ORDER BY is_default DESC, id DESC', [uid]);
  res.render('account', { me, addresses, ok: req.query.ok || null, err: req.query.err || null });
});

app.post('/account/profile', requireLogin, async (req, res) => {
  const name = (req.body.full_name || '').trim();
  if (!name) return res.redirect('/account?err=' + enc('Họ tên không được để trống.'));
  await pool.query('UPDATE users SET full_name = ?, phone = ? WHERE id = ?',
    [name, (req.body.phone || '').trim() || null, req.session.user.id]);
  req.session.user.full_name = name;
  res.redirect('/account?ok=' + enc('Đã cập nhật thông tin.'));
});

app.post('/account/password', requireLogin, async (req, res) => {
  const { old_password, new_password, confirm } = req.body;
  const go = (k, m) => res.redirect(`/account?${k}=${enc(m)}`);
  if (!new_password || new_password.length < 6) return go('err', 'Mật khẩu mới phải có ít nhất 6 ký tự.');
  if (new_password !== confirm) return go('err', 'Mật khẩu nhập lại không khớp.');
  const [[u]] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.session.user.id]);
  if (!(await bcrypt.compare(old_password || '', u.password_hash))) return go('err', 'Mật khẩu hiện tại không đúng.');
  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?',
    [await bcrypt.hash(new_password, 10), req.session.user.id]);
  go('ok', 'Đã đổi mật khẩu.');
});

app.post('/account/addresses', requireLogin, async (req, res) => {
  const uid = req.session.user.id;
  const { recipient_name, phone, province, district, ward, street } = req.body;
  if (![recipient_name, phone, province, district, ward, street].every((v) => v && v.trim())) {
    return res.redirect('/account?err=' + enc('Vui lòng nhập đầy đủ thông tin địa chỉ.'));
  }
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM addresses WHERE user_id = ?', [uid]);
  const isDefault = req.body.is_default === '1' || n === 0 ? 1 : 0;
  if (isDefault) await pool.query('UPDATE addresses SET is_default = 0 WHERE user_id = ?', [uid]);
  await pool.query(
    `INSERT INTO addresses (user_id, recipient_name, phone, province, district, ward, street, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [uid, recipient_name.trim(), phone.trim(), province.trim(), district.trim(), ward.trim(), street.trim(), isDefault]);
  res.redirect('/account?ok=' + enc('Đã thêm địa chỉ.'));
});

app.post('/account/addresses/:id/default', requireLogin, async (req, res) => {
  const uid = req.session.user.id;
  const [rows] = await pool.query('SELECT id FROM addresses WHERE id = ? AND user_id = ?', [Number(req.params.id), uid]);
  if (rows[0]) await pool.query('UPDATE addresses SET is_default = (id = ?) WHERE user_id = ?', [rows[0].id, uid]);
  res.redirect('/account');
});

app.post('/account/addresses/:id/delete', requireLogin, async (req, res) => {
  try {
    await pool.query('DELETE FROM addresses WHERE id = ? AND user_id = ?',
      [Number(req.params.id), req.session.user.id]);
    res.redirect('/account?ok=' + enc('Đã xóa địa chỉ.'));
  } catch (err) {
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.redirect('/account?err=' + enc('Địa chỉ này đã dùng cho đơn hàng nên không thể xóa.'));
    }
    throw err;
  }
});

// ---------- Chi tiet don hang (co van chuyen) ----------
app.get('/orders/:id', requireLogin, async (req, res) => {
  const [orders] = await pool.query(`
    SELECT o.*, a.recipient_name, a.phone, a.street, a.ward, a.district, a.province,
           pay.method, pay.status AS pay_status
    FROM orders o
    JOIN addresses a ON a.id = o.address_id
    LEFT JOIN payments pay ON pay.order_id = o.id
    WHERE o.id = ? AND o.user_id = ?`, [Number(req.params.id), req.session.user.id]);
  const order = orders[0];
  if (!order) return res.status(404).send('Không tìm thấy đơn hàng.');

  const [subs] = await pool.query(`
    SELECT so.id, so.status, so.subtotal, s.shop_name, s.slug AS shop_slug,
           sh.carrier, sh.tracking_number
    FROM suborders so
    JOIN shops s ON s.id = so.shop_id
    LEFT JOIN shipments sh ON sh.suborder_id = so.id
    WHERE so.order_id = ? ORDER BY so.id`, [order.id]);
  const [items] = await pool.query(`
    SELECT oi.*, v.product_id
    FROM order_items oi
    JOIN suborders so ON so.id = oi.suborder_id
    JOIN product_variants v ON v.id = oi.variant_id
    WHERE so.order_id = ?`, [order.id]);
  subs.forEach((s) => { s.items = items.filter((i) => i.suborder_id === s.id); });

  res.render('order', {
    order, subs, success: req.query.success === '1',
    ok: req.query.ok || null, err: req.query.err || null,
  });
});

// ---------- Nguoi mua huy don con (chi khi shop chua xac nhan) ----------
app.post('/orders/:id/suborders/:sid/cancel', requireLogin, async (req, res) => {
  const orderId = Number(req.params.id);
  const sid = Number(req.params.sid);
  let key = 'ok';
  let msg = 'Đã hủy đơn hàng của shop. Hàng được hoàn lại kho.';
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query(`
      SELECT so.id, so.status FROM suborders so JOIN orders o ON o.id = so.order_id
      WHERE so.id = ? AND so.order_id = ? AND o.user_id = ? FOR UPDATE`,
      [sid, orderId, req.session.user.id]);
    if (!rows[0]) throw new UserError('Không tìm thấy đơn hàng.');
    if (rows[0].status !== 'pending') throw new UserError('Chỉ hủy được đơn khi shop chưa xác nhận.');
    await conn.query(
      `UPDATE product_variants v JOIN order_items oi ON oi.variant_id = v.id
       SET v.stock_quantity = v.stock_quantity + oi.quantity WHERE oi.suborder_id = ?`, [sid]);
    await conn.query("UPDATE suborders SET status = 'cancelled' WHERE id = ?", [sid]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    if (!(err instanceof UserError)) throw err;
    key = 'err';
    msg = err.message;
  } finally {
    conn.release();
  }
  res.redirect(`/orders/${orderId}?${key}=${enc(msg)}`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server chay tai http://localhost:${PORT}`));