package com.harborgoods.shipping;

import org.springframework.stereotype.Service;

@Service
public class ShipmentService {
    private final ShipmentRepository shipments;

    public ShipmentService(ShipmentRepository shipments) {
        this.shipments = shipments;
    }

    public Shipment schedule(String orderRef, boolean discounted) {
        Shipment shipment = new Shipment();
        if (discounted) {
            shipment.includePromoInsert();
        }
        return shipments.save(shipment);
    }
}
