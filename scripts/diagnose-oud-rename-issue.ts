import mongoose from 'mongoose';

async function diagnoseOudRenameIssue() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/ecommerce');
    
    const db = mongoose.connection;
    const categoriesCollection = db.collection('categories');
    const productsCollection = db.collection('products');
    
    console.log('\n==================== OUD RENAME DIAGNOSIS ====================\n');
    
    // Show ALL categories
    const allCats = await categoriesCollection.find({}).toArray();
    console.log(`📂 ALL CATEGORIES IN DATABASE (${allCats.length} total):\n`);
    for (const cat of allCats) {
      const productCount = await productsCollection.countDocuments({ category: cat._id });
      console.log(`   • "${cat.name}" (slug: "${cat.slug}")`);
      console.log(`     ID: ${cat._id}`);
      console.log(`     Products: ${productCount}`);
      console.log(`     isActive: ${cat.isActive}\n`);
    }
    
    // Check for OUD-related categories specifically
    console.log('\n🔍 SEARCHING FOR OUD-RELATED CATEGORIES:\n');
    const oudRelated = await categoriesCollection.find({
      $or: [
        { slug: 'oud' },
        { slug: { $regex: 'oud', $options: 'i' } },
        { name: 'OUD' },
        { name: { $regex: 'oud', $options: 'i' } }
      ]
    }).toArray();
    
    console.log(`Found ${oudRelated.length} OUD-related categories:\n`);
    for (const cat of oudRelated) {
      const productCount = await productsCollection.countDocuments({ category: cat._id });
      console.log(`   • "${cat.name}" (slug: "${cat.slug}")`);
      console.log(`     ID: ${cat._id}`);
      console.log(`     Products: ${productCount}`);
      console.log(`     isActive: ${cat.isActive}\n`);
    }
    
    // Check for duplicate slugs
    console.log('⚠️  CHECKING FOR DUPLICATE SLUGS:\n');
    const slugs = new Map<string, any[]>();
    for (const cat of allCats) {
      const slug = cat.slug.toLowerCase();
      if (!slugs.has(slug)) slugs.set(slug, []);
      slugs.get(slug)!.push(cat);
    }
    
    let hasDuplicates = false;
    for (const [slug, cats] of slugs) {
      if (cats.length > 1) {
        hasDuplicates = true;
        console.log(`   ❌ DUPLICATE SLUG "${slug}":`);
        for (const cat of cats) {
          console.log(`      - ${cat.name} (ID: ${cat._id})`);
        }
        console.log('');
      }
    }
    
    if (!hasDuplicates) {
      console.log('   ✅ No duplicate slugs found\n');
    }
    
    // Test what the filter resolves to
    console.log('🧪 TESTING FILTER RESOLUTION FOR "oud":\n');
    const testFind = await categoriesCollection.findOne({
      isActive: true,
      $or: [
        { slug: 'oud' },
        { slug: 'oud' },
        { name: { $regex: '^oud$', $options: 'i' } },
        { nameAr: { $regex: '^oud$', $options: 'i' } },
        { name: { $regex: 'oud', $options: 'i' } },
      ],
    });
    
    if (testFind) {
      const productCount = await productsCollection.countDocuments({ category: testFind._id });
      console.log(`   Found: "${testFind.name}" (slug: "${testFind.slug}")`);
      console.log(`   ID: ${testFind._id}`);
      console.log(`   Products: ${productCount}`);
    } else {
      console.log('   ❌ Filter returned NO RESULT!');
    }
    
  } catch (error: any) {
    console.error('Error:', error.message);
  } finally {
    await mongoose.disconnect();
  }
}

diagnoseOudRenameIssue();
