function schemaErrors(schema, value, path = "$") {
    const errors = [];
    if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
        errors.push(`${path} is not one of the allowed values`);
    }
    const type = schema.type;
    const matchesType = type === undefined ||
        (type === "object" &&
            value !== null &&
            typeof value === "object" &&
            !Array.isArray(value)) ||
        (type === "array" && Array.isArray(value)) ||
        (type === "string" && typeof value === "string") ||
        (type === "boolean" && typeof value === "boolean") ||
        (type === "number" && typeof value === "number" && Number.isFinite(value)) ||
        (type === "integer" && Number.isInteger(value)) ||
        (type === "null" && value === null);
    if (!matchesType) {
        errors.push(`${path} must be ${String(type)}`);
        return errors;
    }
    if (type === "object" &&
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value)) {
        const record = value;
        const required = Array.isArray(schema.required)
            ? schema.required.filter((entry) => typeof entry === "string")
            : [];
        for (const key of required) {
            if (!(key in record))
                errors.push(`${path}.${key} is required`);
        }
        const properties = schema.properties &&
            typeof schema.properties === "object" &&
            !Array.isArray(schema.properties)
            ? schema.properties
            : {};
        for (const [key, childSchema] of Object.entries(properties)) {
            if (key in record &&
                childSchema &&
                typeof childSchema === "object" &&
                !Array.isArray(childSchema)) {
                errors.push(...schemaErrors(childSchema, record[key], `${path}.${key}`));
            }
        }
        if (schema.additionalProperties === false) {
            for (const key of Object.keys(record)) {
                if (!(key in properties)) {
                    errors.push(`${path}.${key} is not allowed`);
                }
            }
        }
    }
    if (type === "array" && Array.isArray(value)) {
        const itemSchema = schema.items &&
            typeof schema.items === "object" &&
            !Array.isArray(schema.items)
            ? schema.items
            : undefined;
        if (itemSchema) {
            value.forEach((item, index) => {
                errors.push(...schemaErrors(itemSchema, item, `${path}[${index}]`));
            });
        }
    }
    return errors;
}
export function validatedOutput(node, output) {
    if (!node.outputSchema)
        return output;
    const errors = schemaErrors(node.outputSchema, output);
    if (errors.length > 0) {
        throw new Error(`node ${node.id} output schema violation: ${errors.join("; ")}`);
    }
    return output;
}
//# sourceMappingURL=output-schema.js.map