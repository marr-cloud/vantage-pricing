---
name: vantage-pricing
description: Usar cuando se pregunte por el costo, precio o presupuesto de instancias AWS EC2, RDS, ElastiCache, OpenSearch o Redshift (p. ej. "¿cuánto cuesta un m6a.xlarge?", "compara db.r6g.large vs db.m6g.large", "la instancia más barata con 32 GB"), al comparar tipos de instancia por precio, al estimar el costo mensual de instancias de una arquitectura, o al evaluar reserved instances o Savings Plans.
---

# Precios de instancias AWS (Vantage)

Las tools MCP `get_instance_price` y `list_family` (servidor `vantage-pricing`) devuelven precios de lista de Vantage. Responde con esos datos; consulta otra fuente solo si el usuario pide verificar.

## Qué tool usar

| Pregunta | Tool |
|---|---|
| Precio de uno o varios tipos concretos | `get_instance_price`, todos los tipos en una llamada |
| Elegir tamaño ("el más barato con N GB / N vCPU") | `list_family`, y luego `get_instance_price` del elegido para tener reserved y `source_url` |
| Comparar regiones | `get_instance_price` una vez por región |

Si el usuario menciona región, SO o motor, pásalo en `region` / `variant`.

## Forma de la respuesta

1. Precio por hora y por mes, indicando **región**, **variante** (SO o motor) y **on-demand / reserved**.
2. Con más de una opción: tabla (tipo, vCPU, memoria, on-demand/mes, reserved 1 año/mes, reserved 3 años/mes).
3. Las dos últimas líneas de toda respuesta con precios, siempre:

```
Fuente: <source_url de cada instancia citada>
Precio de lista; no incluye EBS/almacenamiento, transferencia de datos, Multi-AZ, impuestos ni descuentos de tu cuenta.
```

## Errores y fuera de alcance

- Si la tool devuelve error, muéstralo y usa lo que sugiere (tamaños, regiones o variantes disponibles).
- Lambda, S3, DynamoDB, NAT Gateway, transferencia de datos y EBS no están cubiertos aquí: dilo, y marca como **"no verificada"** cualquier cifra que no venga de una tool de precios.
