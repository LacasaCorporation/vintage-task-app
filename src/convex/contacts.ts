import { mutation, query } from "./_generated/server";
import { scopeUserId } from "./org";
import { v } from "convex/values";
import { creditState } from "../lib/credit";

const MAX_NAME_LENGTH = 120;
const MAX_FIELD_LENGTH = 240;
const MAX_TAX_ID_LENGTH = 40;
const MAX_CURRENCY_LENGTH = 8;
/** A lead time or credit period longer than this is a typo, not a term. */
const MAX_DAYS = 3650;
const MAX_TAX_PCT = 100;
/** A ceiling above this is almost certainly a slip of the keyboard. */
const MAX_CREDIT_LIMIT = 1_000_000_000;

/**
 * Both tables hold the same shape, so they share one field validator. Every
 * field beyond the name is optional, so a contact saved before these existed
 * still reads true.
 */
const contactFields = {
  name: v.string(),
  contactName: v.optional(v.string()),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  address: v.optional(v.string()),
  note: v.optional(v.string()),
  legalName: v.optional(v.string()),
  contactRole: v.optional(v.string()),
  altPhone: v.optional(v.string()),
  website: v.optional(v.string()),
  taxId: v.optional(v.string()),
  taxOffice: v.optional(v.string()),
  defaultTaxPct: v.optional(v.number()),
  registrationNo: v.optional(v.string()),
  currency: v.optional(v.string()),
  leadTimeDays: v.optional(v.number()),
  creditLimit: v.optional(v.number()),
  creditDays: v.optional(v.number()),
  priceList: v.optional(v.string()),
};

type ContactArgs = {
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  note?: string;
  legalName?: string;
  contactRole?: string;
  altPhone?: string;
  website?: string;
  taxId?: string;
  taxOffice?: string;
  defaultTaxPct?: number;
  registrationNo?: string;
  currency?: string;
  leadTimeDays?: number;
  creditLimit?: number;
  creditDays?: number;
  priceList?: string;
};

/**
 * A day count or percentage that was left blank, or typed as nonsense, comes
 * back as `undefined` rather than a zero the user never asked for.
 */
const cleanCount = (
  value: number | undefined,
  max: number,
  label: string,
): number | undefined => {
  if (value === undefined) return undefined;
  if (!Number.isFinite(value)) throw new Error(`${label} must be a number.`);
  if (value < 0) throw new Error(`${label} can't be negative.`);
  if (value > max) throw new Error(`${label} looks too high.`);
  return Math.round(value * 100) / 100;
};

/** Trim every text field and reject a nameless contact. */
function cleanContact(args: ContactArgs) {
  const name = args.name.trim().replace(/\s+/g, " ");
  if (name.length === 0) throw new Error("Give it a name.");
  if (name.length > MAX_NAME_LENGTH) throw new Error("That name is too long.");
  const field = (value: string | undefined) => {
    const clean = value?.trim().replace(/\s+/g, " ");
    return clean ? clean.slice(0, MAX_FIELD_LENGTH) : undefined;
  };
  const taxId = args.taxId?.trim().replace(/\s+/g, " ").toUpperCase();
  return {
    name,
    contactName: field(args.contactName),
    email: field(args.email),
    phone: field(args.phone),
    address: field(args.address),
    note: field(args.note),
    legalName: field(args.legalName),
    contactRole: field(args.contactRole),
    altPhone: field(args.altPhone),
    website: field(args.website),
    taxId: taxId ? taxId.slice(0, MAX_TAX_ID_LENGTH) : undefined,
    taxOffice: field(args.taxOffice),
    defaultTaxPct: cleanCount(args.defaultTaxPct, MAX_TAX_PCT, "Default tax rate"),
    registrationNo: field(args.registrationNo),
    currency: args.currency?.trim().slice(0, MAX_CURRENCY_LENGTH) || undefined,
    leadTimeDays: cleanCount(args.leadTimeDays, MAX_DAYS, "Lead time"),
    creditLimit: cleanCount(args.creditLimit, MAX_CREDIT_LIMIT, "Credit limit"),
    creditDays: cleanCount(args.creditDays, MAX_DAYS, "Credit period"),
    priceList: field(args.priceList),
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

/**
 * What one vendor currently owes, read on its own so the form can show the
 * headroom without pulling every bill in the workspace.
 */
export const vendorProfile = query({
  args: { id: v.id("vendors") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return null;
    const vendor = await ctx.db.get(id);
    if (vendor === null || vendor.ownerId !== userId) return null;
    const rows = (
      await ctx.db
        .query("purchases")
        .withIndex("by_owner", (q) => q.eq("ownerId", userId))
        .collect()
    ).filter((b) => b.supplierId === id);
    const billed = rows.reduce((sum, b) => sum + b.total, 0);
    const paid = rows
      .filter((b) => b.isPaid === true)
      .reduce((sum, b) => sum + b.total, 0);
    return {
      vendor,
      billCount: rows.length,
      billed: Math.round(billed * 100) / 100,
      paid: Math.round(paid * 100) / 100,
      credit: creditState(vendor.creditLimit, billed - paid),
    };
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

/**
 * What one customer currently owes, read on its own so the form can show the
 * headroom without pulling every invoice in the workspace.
 */
export const customerProfile = query({
  args: { id: v.id("customers") },
  handler: async (ctx, { id }) => {
    const userId = await scopeUserId(ctx);
    if (userId === null) return null;
    const customer = await ctx.db.get(id);
    if (customer === null || customer.ownerId !== userId) return null;
    const rows = (
      await ctx.db
        .query("sales")
        .withIndex("by_owner", (q) => q.eq("ownerId", userId))
        .collect()
    ).filter((s) => s.customerId === id);
    const invoiced = rows.reduce((sum, s) => sum + s.total, 0);
    const received = rows
      .filter((s) => s.isPaid === true)
      .reduce((sum, s) => sum + s.total, 0);
    return {
      customer,
      invoiceCount: rows.length,
      invoiced: Math.round(invoiced * 100) / 100,
      received: Math.round(received * 100) / 100,
      credit: creditState(customer.creditLimit, invoiced - received),
    };
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
