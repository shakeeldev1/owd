import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Category, CategoryDocument } from '../src/modules/categories/schemas/category.schema';
import { Product, ProductDocument } from '../src/modules/products/schemas/product.schema';

/**
 * Cleanup script
 * - Finds categories with isActive=false
 * - Reassigns any products referencing them to appropriate target categories
 * - Deletes the deactivated category documents
 *
 * Run from `server` folder:
 * npm exec ts-node ./scripts/delete-deactivated-categories.ts
 */

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const categoryModel = app.get<Model<CategoryDocument>>(getModelToken(Category.name));
  const productModel = app.get<Model<ProductDocument>>(getModelToken(Product.name));

  // Keep same mapping/heuristics as the merge script
  const targetCategoryDefinitions: Record<string, { name: string; nameAr?: string; description?: string }> = {
    'oud': { name: 'Oud Section', nameAr: 'قسم العود', description: 'Pure oud products' },
    'dehn-al-oud': { name: 'Dehn Al Oud', nameAr: 'دهن العود', description: 'Concentrated oud oils / traditional oud oil' },
    'perfumes-sprays': { name: 'Perfumes & Sprays', nameAr: 'العطور والسبراي', description: 'Regular perfumes and body sprays' },
    'bakhoor': { name: 'Bakhoor', nameAr: 'بخور', description: 'All types of incense / bakhoor products' },
    'incense-burners-lighters': { name: 'Incense Burners & Lighters', nameAr: 'مباخر وولاعات', description: 'Mabkhar, burners and lighters' },
    'other-products': { name: 'Other Products', nameAr: 'منتجات أخرى', description: 'Additional items' },
  };

  const manualCategoryMap: Record<string, string> = {
    'blends': 'oud',
    'cambodian-oud': 'oud',
    'filipino-oud': 'oud',
    'gift-boxes': 'other-products',
    'incense-burners': 'incense-burners-lighters',
    'incense-wood': 'bakhoor',
    'indian-oud': 'oud',
    'indonesian-oud': 'oud',
    'laotian-oud': 'oud',
    'malaysian-oud': 'oud',
    'malino-collection': 'oud',
    'moroki-collection': 'oud',
    'musk-collection': 'oud',
    'premium-blends': 'oud',
    'pure-oud-oil': 'dehn-al-oud',
    'signature-blends': 'oud',
    'special-blends': 'oud',
    'thai-oud': 'oud',
    'vietnamese-oud': 'oud',
    'wholesale': 'other-products',
  };

  function inferTargetFromCategory(cat: { slug?: string; name?: string }) {
    const slug = (cat.slug || '').toLowerCase();
    const name = (cat.name || '').toLowerCase();

    if (manualCategoryMap[slug]) return manualCategoryMap[slug];
    if (/pure|dehn|oil/.test(slug) || /pure|dehn|oil/.test(name)) return 'dehn-al-oud';
    if (/perfume|spray|parfum/.test(slug) || /perfume|spray|parfum/.test(name)) return 'perfumes-sprays';
    if (/incense|bakhoor|bakhour|incense-wood/.test(slug) || /incense|bakhoor|bakhour/.test(name)) {
      if (/burner|mabkhar|lighter|incense-burners/.test(slug) || /burner|mabkhar|lighter/.test(name)) return 'incense-burners-lighters';
      return 'bakhoor';
    }
    if (/burner|mabkhar|lighter/.test(slug) || /burner|mabkhar|lighter/.test(name)) return 'incense-burners-lighters';
    if (/wholesale|gift|box|gift-box/.test(slug) || /wholesale|gift|box/.test(name)) return 'other-products';
    if (/oud|agarwood/.test(slug) || /oud|agarwood/.test(name)) return 'oud';
    return 'other-products';
  }

  try {
    const deactivated = await categoryModel.find({ isActive: false }).lean();
    if (!deactivated.length) {
      console.log('No deactivated categories found. Nothing to do.');
      await app.close();
      process.exit(0);
    }

    console.log(`Found ${deactivated.length} deactivated categories.`);

    // Ensure all target categories exist
    const targetSlugs = Object.keys(targetCategoryDefinitions);
    const existingTargets = await categoryModel.find({ slug: { $in: targetSlugs } }).lean();
    const existingTargetSlugs = new Set(existingTargets.map((c) => c.slug));
    for (const slug of targetSlugs) {
      if (existingTargetSlugs.has(slug)) continue;
      const def = targetCategoryDefinitions[slug];
      await categoryModel.create({
        name: def.name,
        nameAr: def.nameAr || def.name,
        description: def.description || def.name,
        descriptionAr: def.nameAr || def.name,
        slug,
        image: '',
        featured: false,
        isActive: true,
        productCount: 0,
      });
      console.log(`Created missing target category ${slug}`);
    }

    const targetDocs = await categoryModel.find({ slug: { $in: targetSlugs } }).lean();
    const targetBySlug = new Map<string, any>();
    for (const t of targetDocs) targetBySlug.set(t.slug, t);

    for (const c of deactivated) {
      const targetSlug = manualCategoryMap[c.slug] || inferTargetFromCategory({ slug: c.slug, name: c.name });
      const target = targetBySlug.get(targetSlug);
      if (!target) {
        console.warn(`Target ${targetSlug} not found for ${c.slug}. Skipping.`);
        continue;
      }

      const res1 = await productModel.updateMany({ category: c._id }, { $set: { category: target._id, categoryName: target.name } });
      const res2 = await productModel.updateMany({ $or: [{ category: { $exists: false } }, { category: null }], categoryName: { $regex: `^${escapeRegExp(c.name || '')}$`, $options: 'i' } }, { $set: { category: target._id, categoryName: target.name } });

      const updatedCount1 = (res1 as any).modifiedCount ?? (res1 as any).nModified ?? 0;
      const updatedCount2 = (res2 as any).modifiedCount ?? (res2 as any).nModified ?? 0;

      console.log(`Reassigned category ${c.slug} -> ${target.slug}: updated ${updatedCount1} + ${updatedCount2} products`);

      // Safe delete
      const del = await categoryModel.deleteOne({ _id: c._id });
      console.log(`Deleted category ${c.slug}: deletedCount=${(del as any).deletedCount ?? (del as any).n ?? 0}`);
    }

    // Recompute product counts for targets
    for (const [slug, t] of targetBySlug.entries()) {
      const count = await productModel.countDocuments({ category: t._id, status: { $ne: 'archived' } });
      await categoryModel.updateOne({ _id: t._id }, { $set: { productCount: count } });
      console.log(`Target ${slug} productCount -> ${count}`);
    }

    console.log('Cleanup complete.');
  } catch (err) {
    console.error('Cleanup failed:', err);
  } finally {
    await app.close();
    process.exit(0);
  }
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

bootstrap();
