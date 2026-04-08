import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Category, CategoryDocument } from '../src/modules/categories/schemas/category.schema';
import { Product, ProductDocument } from '../src/modules/products/schemas/product.schema';

/**
 * Merge categories migration
 *
 * - Maps existing categories to a reduced set of target categories
 * - Creates target categories if missing
 * - Updates products to reference the new category ObjectId and categoryName
 * - Deactivates old categories (sets isActive=false)
 *
 * IMPORTANT: Review and adjust `manualCategoryMap` and `targetCategoryDefinitions`
 * before running on production. Run from the `server` folder with:
 *
 * npm exec ts-node ./scripts/merge-categories.ts
 */

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);

  const categoryModel = app.get<Model<CategoryDocument>>(getModelToken(Category.name));
  const productModel = app.get<Model<ProductDocument>>(getModelToken(Product.name));

  // Define the final, reduced categories the client asked for.
  const targetCategoryDefinitions: Record<
    string,
    { name: string; nameAr?: string; description?: string; descriptionAr?: string }
  > = {
    'oud': { name: 'Oud Section', nameAr: 'قسم العود', description: 'Pure oud products' },
    'dehn-al-oud': { name: 'Dehn Al Oud', nameAr: 'دهن العود', description: 'Concentrated oud oils / traditional oud oil' },
    'musk': { name: 'Musk', nameAr: 'المسك', description: 'Premium musk and musk-based products' },
    'perfumes-sprays': { name: 'Perfumes & Sprays', nameAr: 'العطور والسبراي', description: 'Regular perfumes and body sprays' },
    'bakhoor': { name: 'Bakhoor', nameAr: 'بخور', description: 'All types of incense / bakhoor products' },
    'incense-burners-lighters': { name: 'Incense Burners & Lighters', nameAr: 'مباخر وولاعات', description: 'Mabkhar, burners and lighters' },
    'other-products': { name: 'Other Products', nameAr: 'منتجات أخرى', description: 'Additional items' },
  };

  // Manual mapping from existing category slug -> target slug. Adjust as needed.
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
    'musk-collection': 'musk',
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

    // Keyword-based heuristics
    if (/pure|dehn|oil/.test(slug) || /pure|dehn|oil/.test(name)) return 'dehn-al-oud';
    if (/musk|kamar/.test(slug) || /musk|kamar/.test(name)) return 'musk';
    if (/perfume|spray|parfum/.test(slug) || /perfume|spray|parfum/.test(name)) return 'perfumes-sprays';
    if (/incense|bakhoor|bakhour|incense-wood/.test(slug) || /incense|bakhoor|bakhour/.test(name)) {
      // incense burners are separate
      if (/burner|mabkhar|lighter|incense-burners/.test(slug) || /burner|mabkhar|lighter/.test(name)) return 'incense-burners-lighters';
      return 'bakhoor';
    }
    if (/burner|mabkhar|lighter/.test(slug) || /burner|mabkhar|lighter/.test(name)) return 'incense-burners-lighters';
    if (/wholesale|gift|box|gift-box/.test(slug) || /wholesale|gift|box/.test(name)) return 'other-products';
    // Default: if contains 'oud' map to 'oud'
    if (/oud|agarwood/.test(slug) || /oud|agarwood/.test(name)) return 'oud';

    // fallback
    return 'other-products';
  }

  try {
    const categories = await categoryModel.find({}).lean();
    if (!categories.length) {
      console.log('No categories found. Exiting.');
      await app.close();
      return;
    }

    // Ensure all target categories exist (create if missing)
    const targetSlugs = Object.keys(targetCategoryDefinitions);
    const existingTargets = await categoryModel.find({ slug: { $in: targetSlugs } }).lean();
    const existingTargetSlugs = new Set(existingTargets.map((c) => c.slug));

    const createdTargets: Record<string, any> = {};
    for (const slug of targetSlugs) {
      if (existingTargetSlugs.has(slug)) continue;
      const def = targetCategoryDefinitions[slug];
      const created = await categoryModel.create({
        name: def.name,
        nameAr: def.nameAr || def.name,
        description: def.description || def.name,
        descriptionAr: def.descriptionAr || def.description || def.nameAr || def.name,
        slug,
        image: '',
        featured: false,
        isActive: true,
        productCount: 0,
      });
      console.log(`Created target category: ${slug} -> ${created._id}`);
      createdTargets[slug] = created;
    }

    // Refresh target categories map
    const targetCategoriesDocs = await categoryModel.find({ slug: { $in: targetSlugs } }).lean();
    const targetBySlug = new Map<string, any>();
    for (const t of targetCategoriesDocs) targetBySlug.set(t.slug, t);

    // Build mapping oldCategoryId -> targetSlug
    const mapping: Array<{ oldId: Types.ObjectId; oldSlug: string; oldName: string; targetSlug: string }>
      = [];

    for (const c of categories) {
      const target = inferTargetFromCategory({ slug: c.slug, name: c.name });
      mapping.push({ oldId: c._id, oldSlug: c.slug, oldName: c.name, targetSlug: target });
    }

    // Apply mapping: update products and deactivate old categories
    for (const m of mapping) {
      const targetDoc = targetBySlug.get(m.targetSlug);
      if (!targetDoc) {
        console.warn(`No target category doc found for slug ${m.targetSlug}. Skipping mapping for ${m.oldSlug}`);
        continue;
      }

      // Update products that reference the old category ObjectId
      const res1 = await productModel.updateMany({ category: m.oldId }, { $set: { category: targetDoc._id, categoryName: targetDoc.name } });

      // Update products that don't have category ObjectId but have categoryName equal to old name
      const res2 = await productModel.updateMany({ $or: [{ category: { $exists: false } }, { category: null }], categoryName: { $regex: `^${escapeRegExp(m.oldName)}$`, $options: 'i' } }, { $set: { category: targetDoc._id, categoryName: targetDoc.name } });

      const updatedCount1 = (res1 as any).modifiedCount ?? (res1 as any).nModified ?? 0;
      const updatedCount2 = (res2 as any).modifiedCount ?? (res2 as any).nModified ?? 0;
      console.log(`Mapped category '${m.oldSlug}' -> '${m.targetSlug}': updated ${updatedCount1} + ${updatedCount2} products`);

      // Deactivate old category (soft)
      await categoryModel.updateOne({ _id: m.oldId }, { $set: { isActive: false } });
    }

    // Recalculate productCount for target categories
    for (const slug of targetSlugs) {
      const t = targetBySlug.get(slug);
      if (!t) continue;
      const count = await productModel.countDocuments({ category: t._id, status: { $ne: 'archived' } });
      await categoryModel.updateOne({ _id: t._id }, { $set: { productCount: count, isActive: true } });
      console.log(`Target category '${slug}' productCount -> ${count}`);
    }

    console.log('Category merge complete. Review results in the database before deleting old categories.');
  } catch (err) {
    console.error('Migration failed:', err);
  } finally {
    await app.close();
    process.exit(0);
  }
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

bootstrap();
