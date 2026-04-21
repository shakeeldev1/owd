import axios from 'axios';

async function testOudFilter() {
  try {
    const API_URL = 'http://localhost:5000';
    
    console.log('\n==================== SHOP FILTER TEST ====================\n');
    
    // First, get all categories to find OUD
    console.log('📂 Fetching categories...');
    const categoriesRes = await axios.get(`${API_URL}/categories`);
    const categories = categoriesRes.data;
    
    console.log(`   Found ${categories.length} categories:`);
    const oudCat = categories.find((c: any) => c.slug === 'oud' || c.name.toLowerCase() === 'oud');
    if (!oudCat) {
      console.log('   ❌ No OUD category found!');
      return;
    }
    console.log(`   ✅ OUD: ${oudCat.productCount} products (ID: ${oudCat._id})`);
    
    // Now test the filter with the OUD slug
    console.log('\n🔍 Testing shop filter with category=oud...');
    const filterRes = await axios.get(`${API_URL}/products`, {
      params: { category: 'oud', limit: 100 }
    });
    
    console.log(`   API returned: ${filterRes.data.total} products (pages: ${filterRes.data.pages})`);
    console.log(`   Received: ${filterRes.data.data.length} products\n`);
    
    if (filterRes.data.data.length > 0) {
      console.log('📋 Products returned:');
      filterRes.data.data.forEach((p: any, i: number) => {
        console.log(`   ${i + 1}. "${p.name}"`);
        console.log(`      Status: ${p.status}, Section: ${p.section}, Category: ${p.category}`);
      });
    }
    
    // Also try with the ObjectId directly
    if (oudCat._id) {
      console.log(`\n🔍 Testing with category ObjectId=${oudCat._id}...`);
      const idFilterRes = await axios.get(`${API_URL}/products`, {
        params: { category: oudCat._id, limit: 100 }
      });
      console.log(`   API returned: ${idFilterRes.data.total} products`);
    }
    
  } catch (error: any) {
    console.error('Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

testOudFilter();
