import { mutation, query } from "./_generated/server";
import { scopeUserId } from "./org";
import { v } from "convex/values";

const MAX_NAME_LENGTH = 120;
const MAX_FIELD_LENGTH = 240;

/** Both tables hold the same shape, so they share one field validator. */
const contactFields = {
  name: v.string(),
  contactName: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  address: v.optional(v.string()),
  note: v.optional(v.string()),
};

/** Trim every text field and reject a nameless contact. */
function cleanContact(args: {
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  note?: string;
}) {
  const name = args.name.trim().replace(/\s+/g, " ");
  if (name.length === 0) throw new Error("Give it a name.");
  if (name.length > MAX_NAME_LENGTH) throw new Error("That name is too long.");
  const field = (value: string | undefined) => {
    const clean = value?.trim().replace(/\s+/g, " ");
    return clean ? clean.slice(0, MAX_FIELD_LENGTH) : undefined;
  };
  return {
    name,
    contactName: field(args.contactName),
    email: field(args.email),
    phone: field(args.phone),
    address: field(args.address),
    note: field(args.note),
  };
}

/** Alphabetical by name, so pickers and lists read the same way. */
function byName<T extends { name: string }>(rows: T[]): T[] {
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

// ── Vendors (suppliers) ──────────────────────────────────────────────

export const listVendors = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    return byName(
      await ctx.db
        .query("vendors")
        .withIndex("by_owner", (q) => q.eq("ownerId", userId))
        .collect(),
    );
  },
});

export const createVendor = mutation({
  args: contactFields,
  handler: async (ctx, args) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const clean = cleanContact(args);
    const existing = await ctx.db
      .query("vendors")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const twin = existing.find(
      (row) => row.name.toLowerCase() === clean.name.toLowerCase(),
    );
    if (twin !== undefined)
      throw new Error(`“${clean.name}” is already in your vendors.`);
    return await ctx.db.insert("vendors", { ownerId: userId, ...clean });
  },
});

export const updateVendor = mutation({
  args: { id: v.id("vendors"), ...contactFields },
  handler: async (ctx, { id, ...args }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const vendor = await ctx.db.get(id);
    if (vendor === null || vendor.ownerId !== userId)
      throw new Error("That vendor no longer exists.");
    await ctx.db.patch(id, cleanContact(args));
  },
});

export const removeVendor = mutation({
  args: { id: v.id("vendors") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const vendor = await ctx.db.get(id);
    if (vendor === null || vendor.ownerId !== userId) return;
    await ctx.db.delete(id);
  },
});

// ── Customers ────────────────────────────────────────────────────────

export const listCustomers = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    return byName(
      await ctx.db
        .query("customers")
        .withIndex("by_owner", (q) => q.eq("ownerId", userId))
        .collect(),
    );
  },
});

export const createCustomer = mutation({
  args: contactFields,
  handler: async (ctx, args) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const clean = cleanContact(args);
    const existing = await ctx.db
      .query("customers")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    const twin = existing.find(
      (row) => row.name.toLowerCase() === clean.name.toLowerCase(),
    );
    if (twin !== undefined)
      throw new Error(`“${clean.name}” is already in your customers.`);
    return await ctx.db.insert("customers", { ownerId: userId, ...clean });
  },
});

export const updateCustomer = mutation({
  args: { id: v.id("customers"), ...contactFields },
  handler: async (ctx, { id, ...args }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const customer = await ctx.db.get(id);
    if (customer === null || customer.ownerId !== userId)
      throw new Error("That customer no longer exists.");
    await ctx.db.patch(id, cleanContact(args));
  },
});

export const removeCustomer = mutation({
  args: { id: v.id("customers") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const customer = await ctx.db.get(id);
    if (customer === null || customer.ownerId !== userId) return;
    await ctx.db.delete(id);
  },
});

/**
 * Every customer with the projects that belong to them, so the customer list
 * shows each one with its work rather than a bare name.
 */
export const listCustomersWithProjects = query({
  args: {},
  handler: async (ctx) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return [];
    const customers = byName(
      await ctx.db
        .query("customers")
        .withIndex("by_owner", (q) => q.eq("ownerId", userId))
        .collect(),
    );
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .collect();
    return customers.map((customer) => ({
      customer,
      projects: projects.filter(
        (project) => project.client === customer.name,
      ),
    }));
  },
});
