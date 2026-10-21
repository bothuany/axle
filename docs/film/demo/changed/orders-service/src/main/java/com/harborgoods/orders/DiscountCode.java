package com.harborgoods.orders;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "discount_codes")
public class DiscountCode {
    @Id
    @Column(length = 24)
    private String code;

    @Column(name = "percent_off", nullable = false)
    private Integer percentOff;

    @Column(name = "expires_at")
    private Instant expiresAt;

    public boolean isValid(Instant now) {
        return expiresAt == null || now.isBefore(expiresAt);
    }

    public long amountOff(long totalCents) {
        return totalCents * percentOff / 100;
    }
}
