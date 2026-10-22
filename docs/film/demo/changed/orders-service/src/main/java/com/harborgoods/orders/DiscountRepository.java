package com.harborgoods.orders;

import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface DiscountRepository extends JpaRepository<DiscountCode, String> {
    Optional<DiscountCode> findByCodeIgnoreCase(String code);
}
