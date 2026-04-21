import mongoose from 'mongoose';

async function diagnoseOudCategory() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ecommerce');
    
    const db = mongoose.connection;
    const categoriesCollection = db.collection('categories');
    const productsCollection = db.collection('products');
    
    console.log('\n==================== OUD CATEGORY DIAGNOSIS ====================\n');
    
    // 1. Check if any "oud" categories exist (case-insensitive)
    console.log('🔍 1. CHECKING FOR "OUD" CATEGORIES (all variations):');
    const oudCategories = await categoriesCollection.find({
      $or: [
        { name: 'OUD' },
        { name: 'Oud' },
        { name: 'oud' },
        { slug: 'oud' },
        { nameAr: /عود|اود/i },
      ]
    }).toArray();
    
    console.log(`   Found ${oudCategories.length} category(ies):`);
    for (const cat of oudCategories) {
      console.log(`   - ID: ${cat._id}`);
      console.log(`     Name: "${cat.name}"`);
      console.log(`     Slug: "${cat.slug}"`);
      console.log(`     isActive: ${cat.isActive}`);
      console.log(`     featured: ${cat.featured}`);
    }
    
    // 2. Check products assigned to oud categories
    console.log('\n📦 2. PRODUCTS ASSIGNED TO OUD CATEGORY:');
    
    for (const cat of oudCategories) {
      const productCount = await productsCollection.countDocuments({
        category: cat._id,
        status: 'active'
      });
      
      console.log(`   "${cat.name}" (ID: ${cat._id}): ${productCount} active products`);
      
      if (productCount > 0) {
        const products = await productsCollection
          .find({ category: cat._id, status: 'active' })
          .limit(5)
          .project({ _id: 1, name: 1, category: 1, categoryName: 1 })
          .toArray();
        
        products.forEach((p, i) => {
          console.log(`     ${i + 1}. ${p.name}`);
          console.log(`        Category ObjectId: ${p.category}`);
          console.log(`        CategoryName: ${p.categoryName}`);
        });
        
        if (productCount > 5) {
          console.log(`     ... and ${productCount - 5} more products`);
        }
      }
    }
    
    // 3. Test slug generation
    console.log('\n🔧 3. SLUG GENERATION TEST:');
    const testNames = ['OUD', 'Oud', 'oud', 'Test', 'test', 'TEST'];
    
    for (const name of testNames) {
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
      console.log(`   "${name}" → slug: "${slug}"`);
    }
    
    // 4. Check for slug uniqueness constraint violations
    console.log('\n🔐 4. SLUG UNIQUENESS CHECK:');
    const allCategories = await categoriesCollection.find({}).toArray();
    const slugCounts = new Map<string, number>();
    
    for (const cat of allCategories) {
      const count = (slugCounts.get(cat.slug) || 0) + 1;
      slugCounts.set(cat.slug, count);
    }
    
    let duplicateSlugs = 0;
    for (const [slug, count] of slugCounts.entries()) {
      if (count > 1) {
        console.log(`   ⚠️  Slug "${slug}" appears ${count} times (VIOLATION!)`);
        duplicateSlugs++;
        
        const duplicates = await categoriesCollection
          .find({ slug })
          .project({ _id: 1, name: 1, isActive: 1 })
          .toArray();
        
        duplicates.forEach(d => {
          console.log(`       - ${d.name} (${d._id}, active: ${d.isActive})`);
        });
      }
    }
    
    if (duplicateSlugs === 0) {
      console.log(`   ✅ All slugs are unique (${slugCounts.size} total)`);
    }
    
    // 5. Test the filter resolution logic directly
    console.log('\n🎯 5. FILTER RESOLUTION TEST FOR "OUD":');
    const testSlug = 'oud';
    const spacedCategory = testSlug.replace(/[-_]+/g, ' ');
    
    const resolved = await categoriesCollection.findOne({
      isActive: true,
      $or: [
        { slug: testSlug.toLowerCase() },
        { slug: spacedCategory.toLowerCase() },
        { name: { $regex: '^' + spacedCategory + '$', $options: 'i' } },
        { nameAr: { $regex: '^' + spacedCategory + '$', $options: 'i' } },
        { name: { $regex: testSlug, $options: 'i' } },
      ],
    });
    
    if (resolved) {
      console.log(`   ✅ Resolved "oud" to: "${resolved.name}" (ID: ${resolved._id})`);
      
      const products = await productsCollection.countDocuments({
        category: resolved._id,
        status: 'active'
      });
      console.log(`   Products found: ${products}`);
    } else {
      console.log(`   ❌ Could NOT resolve "oud" - no active category found`);
      console.log(`   This means filtering by ?category=oud will fail`);
    }
    
    // 6. Check if there's an inactive "oud" category blocking the active one
    console.log('\n⚠️  6. INACTIVE CATEGORY CHECK:');
    const inactiveOud = await categoriesCollection.find({
      isActive: false,
      $or: [
        { slug: 'oud' },
        { name: /^oud$/i },
      ]
    }).toArray();
    
    if (inactiveOud.length > 0) {
      console.log(`   ⚠️  Found ${inactiveOud.length} INACTIVE "oud" category(ies):`);
      inactiveOud.forEach(cat => {
        console.log(`       - ${cat.name} (${cat._id})`);
      });
      console.log(`   These won't work for filtering!`);
    } else {
      console.log(`   ✅ No inactive "oud" categories found`);
    }
    
    // 7. Recommendations
    console.log('\n💡 RECOMMENDATIONS:');
    
    if (oudCategories.length === 0) {
      console.log('   1. "OUD" category does not exist');
      console.log('   2. Create it fresh and verify isActive: true');
    } else if (oudCategories.some(c => !c.isActive)) {
      console.log('   1. Deactivate or delete old inactive "oud" categories');
      console.log('   2. Ensure new "OUD" category has isActive: true');
    } else {
      console.log('   1. "OUD" category exists and is active');
      console.log('   2. Verify products are assigned to correct ObjectId');
      console.log('   3. Check client is sending correct filter parameter');
    }
    
  } catch (error: any) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

diagnoseOudCategory();
