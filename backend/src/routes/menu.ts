import { Router, Response } from 'express';
import { prisma } from '../db';
import { authenticate, requireRoles } from '../middleware/auth';
import { AuthRequest } from '../types';
import { emitDataUpdated } from '../socket';

const router = Router();

// GET /api/menu - Fetch all menu items with calculated dynamic stock availability
router.get('/', async (_req, res: Response) => {
  try {
    const menuItems = await prisma.menuItem.findMany({
      include: {
        recipe: {
          include: {
            ingredient: true,
          },
        },
      },
      orderBy: { category: 'asc' },
    });

    // Calculate maximum available portions for each menu item based on current ingredient stocks
    const formattedMenuItems = menuItems.map((item) => {
      let maxPortions = Infinity;

      if (item.recipe && item.recipe.length > 0) {
        for (const r of item.recipe) {
          if (r.quantityRequired > 0) {
            const portions = Math.floor(r.ingredient.currentStock / r.quantityRequired);
            if (portions < maxPortions) {
              maxPortions = portions;
            }
          }
        }
      } else {
        maxPortions = item.isAvailable ? 999 : 0;
      }

      if (maxPortions === Infinity) maxPortions = 0;
      const isStockAvailable = maxPortions > 0 && item.isAvailable;

      return {
        ...item,
        availableStock: maxPortions,
        isStockAvailable,
      };
    });

    return res.json({ menuItems: formattedMenuItems });
  } catch (error: any) {
    console.error('Fetch menu error:', error);
    return res.status(500).json({ 
      error: 'Failed to fetch menu items', 
      details: error?.message || String(error) 
    });
  }
});

// POST /api/menu - Add new menu item (Admin only)
router.post('/', authenticate, requireRoles(['ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const { name, description, price, category, image, isAvailable, recipe } = req.body;

    if (!name || price === undefined || !category) {
      return res.status(400).json({ error: 'Name, price, and category are required' });
    }

    const menuItem = await prisma.menuItem.create({
      data: {
        name,
        description: description || '',
        price: parseFloat(price),
        category,
        image: image || null,
        isAvailable: isAvailable !== undefined ? Boolean(isAvailable) : true,
        recipe: {
          create: Array.isArray(recipe)
            ? recipe.map((r: { ingredientId: string; quantityRequired: number }) => ({
                ingredientId: r.ingredientId,
                quantityRequired: parseFloat(r.quantityRequired.toString()),
              }))
            : [],
        },
      },
      include: {
        recipe: {
          include: { ingredient: true },
        },
      },
    });

    emitDataUpdated();
    return res.status(201).json({ message: 'Menu item created successfully', menuItem });
  } catch (error: any) {
    console.error('Create menu item error:', error);
    return res.status(500).json({ error: 'Failed to create menu item' });
  }
});

// PUT /api/menu/:id - Update menu item (Admin only)
router.put('/:id', authenticate, requireRoles(['ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { name, description, price, category, image, isAvailable, recipe } = req.body;

    // First delete existing recipe mappings if new recipe list provided
    if (Array.isArray(recipe)) {
      await prisma.menuItemIngredient.deleteMany({
        where: { menuItemId: id },
      });
    }

    const updatedItem = await prisma.menuItem.update({
      where: { id },
      data: {
        name,
        description,
        price: price !== undefined ? parseFloat(price) : undefined,
        category,
        image,
        isAvailable: isAvailable !== undefined ? Boolean(isAvailable) : undefined,
        recipe: Array.isArray(recipe)
          ? {
              create: recipe.map((r: { ingredientId: string; quantityRequired: number }) => ({
                ingredientId: r.ingredientId,
                quantityRequired: parseFloat(r.quantityRequired.toString()),
              })),
            }
          : undefined,
      },
      include: {
        recipe: {
          include: { ingredient: true },
        },
      },
    });

    emitDataUpdated();
    return res.json({ message: 'Menu item updated successfully', menuItem: updatedItem });
  } catch (error: any) {
    console.error('Update menu item error:', error);
    return res.status(500).json({ error: 'Failed to update menu item' });
  }
});

// DELETE /api/menu/:id - Delete menu item (Admin only)
router.delete('/:id', authenticate, requireRoles(['ADMIN']), async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    await prisma.menuItem.delete({ where: { id } });
    emitDataUpdated();
    return res.json({ message: 'Menu item deleted successfully' });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to delete menu item' });
  }
});

export default router;
