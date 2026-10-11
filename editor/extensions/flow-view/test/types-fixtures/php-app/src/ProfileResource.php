<?php
class Badge
{
    public string $label;
}

class ProfileResource
{
    public string $name;
    public ?Badge $badge;
}
