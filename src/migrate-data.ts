/* eslint-disable @typescript-eslint/no-require-imports */
const mongoose = require('mongoose');

const SOURCE_URI = 'mongodb://localhost:27017/alfursan-oud';
const TARGET_URI = 'mongodb+srv://yaa39814_db_user:pe6a8d8Bzaf42TN5@cluster0.y1xh4lm.mongodb.net/oudalzubarah';

// Source Schemas
const SourceCategorySchema = new mongoose.Schema({}, { strict: false });
const SourceProductSchema = new mongoose.Schema({}, { strict: false });

const SourceCategory = mongoose.model('SourceCategory', SourceCategorySchema, 'categories');
const SourceProduct = mongoose.model('SourceProduct', SourceProductSchema, 'products');

async function migrateData() {
  let sourceConn;
  let targetConn;
  
  try {
    console.log('=== Starting Migration ===\n');

    // Step 1: Connect to source database and fetch data
    console.log('Connecting to source database...');
    sourceConn = await mongoose.connect(SOURCE_URI);
    console.log('Connected to source database\n');

    console.log('Fetching categories from source...');
    const sourceCategories = await SourceCategory.find({});
    console.log(`Found ${sourceCategories.length} categories\n`);

    console.log('Fetching products from source...');
    const sourceProducts = await SourceProduct.find({});
    console.log(`Found ${sourceProducts.length} products\n`);

    // Disconnect from source
    await mongoose.disconnect();
    console.log('Disconnected from source database\n');

    // Step 2: Connect to target database
    console.log('Connecting to target database...');
    targetConn = await mongoose.connect(TARGET_URI);
    console.log('Connected to target database\n');

    const db = mongoose.connection.db;

    // Step 3: Clear existing products and categories in target (using direct collection access)
    console.log('Clearing existing data in target database...');
    await db.collection('categories').deleteMany({});
    await db.collection('products').deleteMany({});
    // Also clean up old migration collections
    await db.collection('targetcategories').deleteMany({});
    await db.collection('targetproducts').deleteMany({});
    console.log('Cleared existing data\n');

    // Step 4: Insert categories
    console.log('Inserting categories into target database...');
    const categoryMapping = {};
    
    for (const cat of sourceCategories) {
      const catData = {
        name: cat.name,
        nameAr: cat.nameAr,
        description: cat.description,
        descriptionAr: cat.descriptionAr,
        image: cat.image,
        slug: cat.slug,
        productCount: cat.productCount || 0,
        featured: cat.featured || false,
        isActive: cat.isActive !== false,
        createdAt: cat.createdAt || new Date(),
        updatedAt: cat.updatedAt || new Date(),
      };
      
      const result = await db.collection('categories').insertOne(catData);
      if (cat._id) {
        categoryMapping[cat._id.toString()] = result.insertedId;
      }
      console.log(`  - Migrated category: ${cat.name || cat.nameAr}`);
    }
    console.log(`\nMigrated ${sourceCategories.length} categories\n`);

    // Step 5: Insert products with updated category references
    console.log('Inserting products into target database...');
    for (const prod of sourceProducts) {
      const productData = {
        name: prod.name,
        nameAr: prod.nameAr,
        description: prod.description,
        descriptionAr: prod.descriptionAr,
        price: prod.price,
        originalPrice: prod.originalPrice,
        image: prod.image,
        images: prod.images || [],
        slug: prod.slug,
        sku: prod.sku,
        category: prod.category ? categoryMapping[prod.category.toString()] : null,
        categoryName: prod.categoryName,
        rating: prod.rating || 0,
        reviews: prod.reviews || 0,
        badge: prod.badge,
        badgeAr: prod.badgeAr,
        isNewArrival: prod.isNewArrival || false,
        isBestseller: prod.isBestseller || false,
        isLimitedEdition: prod.isLimitedEdition || false,
        isFeatured: prod.isFeatured || false,
        stock: prod.stock || 50,
        sales: prod.sales || 0,
        status: prod.status || 'active',
        weight: prod.weight,
        createdAt: prod.createdAt || new Date(),
        updatedAt: prod.updatedAt || new Date(),
      };
      
      await db.collection('products').insertOne(productData);
      console.log(`  - Migrated product: ${prod.name || prod.nameAr}`);
    }
    console.log(`\nMigrated ${sourceProducts.length} products\n`);

    // Step 6: Verify counts
    const targetCategories = await db.collection('categories').countDocuments();
    const targetProducts = await db.collection('products').countDocuments();
    
    console.log('=== Migration Complete ===');
    console.log(`Categories in target: ${targetCategories}`);
    console.log(`Products in target: ${targetProducts}`);

    await mongoose.disconnect();
    console.log('\nDisconnected from target database');
    console.log('Migration finished successfully!');
    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error);
    if (sourceConn) await mongoose.disconnect();
    if (targetConn) await mongoose.disconnect();
    process.exit(1);
  }
}

migrateData();
