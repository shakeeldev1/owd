/**
 * Comprehensive Category System Test
 * Tests: Create, Read, Update, Delete, and Filter operations
 */

import axios from 'axios';

const API_BASE = process.env.API_URL || 'http://localhost:3001';
const API = axios.create({
  baseURL: API_BASE,
  validateStatus: () => true, // Don't throw on any status
});

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const results: TestResult[] = [];

async function test(name: string, fn: () => Promise<void>) {
  try {
    console.log(`\n⏳ Testing: ${name}`);
    await fn();
    console.log(`✅ PASSED: ${name}`);
    results.push({ name, passed: true });
  } catch (error: any) {
    console.log(`❌ FAILED: ${name}`);
    console.log(`   Error: ${error.message}`);
    results.push({ name, passed: false, error: error.message });
  }
}

async function runTests() {
  console.log('\n==================== CATEGORY SYSTEM TESTS ====================\n');

  let categoryId: string;
  let categorySlug: string;

  // Test 1: Create Category
  await test('Create new category with proper defaults', async () => {
    const response = await API.post('/categories', {
      name: 'Test Category',
      nameAr: 'فئة اختبار',
      description: 'Test Description',
      descriptionAr: 'وصف الاختبار',
      featured: false,
    });

    if (response.status !== 201) {
      throw new Error(`Expected 201, got ${response.status}: ${JSON.stringify(response.data)}`);
    }

    const category = response.data.category;
    categoryId = category._id;
    categorySlug = category.slug;

    // Verify defaults
    if (category.isActive !== true) throw new Error('isActive should be true');
    if (category.featured !== false) throw new Error('featured should be false');
    if (category.displayOrder !== 999) throw new Error('displayOrder should be 999');
    if (!category.slug) throw new Error('slug should be generated');
    if (category.slug !== 'test-category') throw new Error(`slug should be 'test-category', got '${category.slug}'`);

    console.log(`   Created: ${category.name} (ID: ${categoryId}, slug: ${categorySlug})`);
  });

  // Test 2: Get Categories
  await test('Get all categories includes newly created category', async () => {
    const response = await API.get('/categories');

    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}`);
    }

    const categories = response.data;
    if (!Array.isArray(categories)) throw new Error('Response should be array');

    const found = categories.find((c: any) => c._id === categoryId);
    if (!found) throw new Error(`Category ${categoryId} not found in list`);
    if (found.isActive !== true) throw new Error('Category isActive should be true');

    console.log(`   Found category in list (productCount: ${found.productCount || 0})`);
  });

  // Test 3: Find by Slug
  await test('Find category by slug returns active category', async () => {
    const response = await API.get(`/categories/${categorySlug}`);

    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}`);
    }

    const category = response.data;
    if (category._id !== categoryId) throw new Error('Wrong category returned');
    if (category.slug !== categorySlug) throw new Error('Slug mismatch');
    if (category.isActive !== true) throw new Error('Category should be active');

    console.log(`   Resolved slug "${categorySlug}" to category: ${category.name}`);
  });

  // Test 4: Update Category
  await test('Update category maintains isActive and syncs data', async () => {
    const response = await API.patch(`/categories/${categoryId}`, {
      name: 'Updated Test Category',
      nameAr: 'فئة اختبار محدثة',
    });

    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}`);
    }

    const updated = response.data.category;
    if (updated.name !== 'Updated Test Category') throw new Error('Name not updated');
    if (updated.isActive !== true) throw new Error('isActive should remain true');
    if (updated.slug !== 'updated-test-category') throw new Error('Slug should be regenerated');

    console.log(`   Updated category name and verified slug regeneration`);
  });

  // Test 5: Create Product (Prerequisite for deletion test)
  let productId: string;
  await test('Create product with valid category ObjectId', async () => {
    const response = await API.post('/products', {
      name: 'Test Product',
      nameAr: 'منتج الاختبار',
      description: 'Test product description',
      descriptionAr: 'وصف منتج الاختبار',
      price: 100,
      category: categoryId,
      categoryName: 'Updated Test Category',
      sku: 'TEST-SKU-001',
      image: 'https://example.com/image.jpg',
      stock: 10,
      status: 'active',
    });

    if (response.status !== 201) {
      throw new Error(`Expected 201, got ${response.status}: ${JSON.stringify(response.data)}`);
    }

    productId = response.data._id;
    if (!response.data.category) throw new Error('Product should have category ObjectId');

    console.log(`   Created product with category ObjectId reference`);
  });

  // Test 6: Filter by Category
  await test('Filter products by category slug returns correct product', async () => {
    const response = await API.get(`/products?category=${categorySlug}`);

    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}`);
    }

    const data = response.data;
    if (data.total === 0) throw new Error('No products returned for category filter');
    if (!data.products.some((p: any) => p._id === productId)) {
      throw new Error('Created product not found in filtered results');
    }

    console.log(`   Filtered by slug "${categorySlug}" returned ${data.total} product(s)`);
  });

  // Test 7: Ensure Other Products Category Exists (for deletion test)
  await test('Verify Other Products category exists or will be created', async () => {
    let response = await API.get('/categories/other-products');

    if (response.status === 404) {
      // Create it
      response = await API.post('/categories', {
        name: 'Other Products',
        nameAr: 'منتجات أخرى',
        description: 'Products without specific category',
        descriptionAr: 'منتجات بدون فئة محددة',
      });

      if (response.status !== 201) {
        throw new Error(`Failed to create Other Products: ${response.status}`);
      }
    }

    if (response.status !== 200 && response.status !== 201) {
      throw new Error(`Expected 200 or 201, got ${response.status}`);
    }

    console.log(`   Other Products category ready`);
  });

  // Test 8: Delete Category
  await test('Delete category moves products to Other Products', async () => {
    const response = await API.delete(`/categories/${categoryId}`);

    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}`);
    }

    if (response.data.movedProductsCount === undefined) {
      throw new Error('Response should include movedProductsCount');
    }

    if (response.data.movedProductsCount !== 1) {
      throw new Error(`Expected 1 product moved, got ${response.data.movedProductsCount}`);
    }

    console.log(`   Deleted category and moved ${response.data.movedProductsCount} product(s) to Other Products`);
  });

  // Test 9: Verify Product Moved
  await test('Verify product was moved to Other Products category', async () => {
    const response = await API.get(`/products/${productId}`);

    if (response.status !== 200) {
      throw new Error(`Expected 200, got ${response.status}`);
    }

    const product = response.data;
    const otherCatResponse = await API.get('/categories/other-products');
    const otherCategory = otherCatResponse.data;

    if (product.category !== otherCategory._id) {
      throw new Error(`Product should be in Other Products category`);
    }

    console.log(`   Product successfully moved to Other Products category`);
  });

  // Test 10: Verify Deleted Category Not Found
  await test('Deleted category cannot be filtered', async () => {
    const response = await API.get(`/categories/${categorySlug}`);

    // Should NOT find the deleted category
    if (response.status === 200) {
      throw new Error('Deleted category should not be found');
    }

    console.log(`   Deleted category correctly not found in filter results`);
  });

  // Summary
  console.log('\n==================== TEST SUMMARY ====================\n');
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;

  console.log(`✅ Passed: ${passed}/${results.length}`);
  console.log(`❌ Failed: ${failed}/${results.length}`);

  if (failed > 0) {
    console.log('\n❌ FAILED TESTS:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`   - ${r.name}: ${r.error}`);
    });
  } else {
    console.log('\n🎉 ALL TESTS PASSED! Category system is working correctly.');
  }

  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
